// T-033: unduh media dari Telegram (FR-MED-001). Dua langkah sesuai Bot API:
//   1. getFile(file_id) → file_path
//   2. GET https://api.telegram.org/file/bot<token>/<file_path> → bytes
//
// Token bot muncul di URL unduhan — itu memang cara Bot API bekerja, jadi URL ini TIDAK
// boleh dicatat ke log atau dibocorkan ke pengguna.

import { MEDIA_MAX_BYTES, err, ok } from '@digimaestro/shared';
import type { DownloadedMedia, MediaDownloadPort, MediaError, Result } from '@digimaestro/shared';

const TELEGRAM_API = 'https://api.telegram.org';

// fetch runtime (Node 20+). Disuntik → adapter teruji tanpa jaringan.
// `init.signal` WAJIB didukung: tanpa timeout, unduhan yang stall menggantung sampai default
// undici (±5 menit) → job `chat-inbound` tersita selama itu, dan BullMQ (lockDuration 30 dtk)
// menganggapnya stalled lalu memprosesnya ulang di worker lain (P0 audit).
export type MediaFetch = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<{
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface TelegramMediaDownloadOptions {
  readonly botToken: string;
  readonly fetch: MediaFetch;
  readonly baseUrl?: string;
  readonly maxBytes?: number;
  // Timeout metadata (getFile) & unduhan isi. Unduhan diberi jendela lebih lebar.
  readonly metaTimeoutMs?: number;
  readonly downloadTimeoutMs?: number;
}

export const DEFAULT_META_TIMEOUT_MS = 15_000;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

export class TelegramMediaDownload implements MediaDownloadPort {
  constructor(private readonly options: TelegramMediaDownloadOptions) {}

  async download(mediaRef: string): Promise<Result<DownloadedMedia, MediaError>> {
    const base = this.options.baseUrl ?? TELEGRAM_API;
    const maxBytes = this.options.maxBytes ?? MEDIA_MAX_BYTES;

    // 1) file_id → file_path
    let filePath: string;
    let declaredSize: number | undefined;
    try {
      const res = await this.options.fetch(
        `${base}/bot${this.options.botToken}/getFile?file_id=${encodeURIComponent(mediaRef)}`,
        { signal: AbortSignal.timeout(this.options.metaTimeoutMs ?? DEFAULT_META_TIMEOUT_MS) },
      );
      if (res.status < 200 || res.status >= 300) {
        return err({ code: 'DOWNLOAD', message: `getFile HTTP ${res.status}` });
      }
      const body = (await res.json()) as {
        ok?: boolean;
        description?: string;
        result?: { file_path?: string; file_size?: number };
      };
      if (body.ok !== true || !body.result?.file_path) {
        return err({
          code: 'DOWNLOAD',
          message: `getFile ditolak: ${body.description ?? 'tak ada file_path'}`,
        });
      }
      filePath = body.result.file_path;
      declaredSize = body.result.file_size;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'DOWNLOAD', message: `gagal getFile: ${message}` });
    }

    // Tolak SEBELUM mengunduh bila Telegram sudah menyatakan ukurannya kelewat besar —
    // percuma menarik 50 MB hanya untuk membuangnya.
    if (declaredSize !== undefined && declaredSize > maxBytes) {
      return err({
        code: 'TOO_LARGE',
        message: `media ${declaredSize} byte melebihi batas ${maxBytes}`,
      });
    }

    // 2) unduh isinya
    try {
      const res = await this.options.fetch(
        `${base}/file/bot${this.options.botToken}/${filePath}`,
        {
          signal: AbortSignal.timeout(
            this.options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
          ),
        },
      );
      if (res.status < 200 || res.status >= 300) {
        return err({ code: 'DOWNLOAD', message: `unduh media HTTP ${res.status}` });
      }
      const buf = new Uint8Array(await res.arrayBuffer());

      // Sabuk pengaman: file_size bisa absen/salah, jadi ukuran nyata tetap diperiksa.
      if (buf.byteLength > maxBytes) {
        return err({
          code: 'TOO_LARGE',
          message: `media ${buf.byteLength} byte melebihi batas ${maxBytes}`,
        });
      }

      return ok({ bytes: buf, contentType: guessContentType(filePath) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'DOWNLOAD', message: `gagal mengunduh media: ${message}` });
    }
  }
}

// contentType hanya petunjuk awal; prosesor (sharp) yang menentukan format akhir.
function guessContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}
