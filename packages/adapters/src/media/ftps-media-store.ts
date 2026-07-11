// T-033: simpan media ke hosting cPanel via FTPS, lalu kembalikan URL PUBLIK.
//
// Kenapa di hosting, bukan MinIO: galeri situs merender <img src>, jadi media WAJIB punya
// URL yang bisa dibuka pengunjung. VPS kita tak punya domain publik (alasan yang sama
// membuat webhook Telegram mustahil → long-polling), sehingga MinIO di VPS tak bisa
// menyajikannya. Hosting cPanel adalah satu-satunya ruang yang benar-benar publik, dan
// situsnya memang sudah terbit di sana (ADR-13).
//
// LETAK MEDIA PENTING: media TIDAK boleh tinggal di docroot situs (`<slug>/`). Deploy
// publish adalah MIRROR PENUH — file yang tak ada di rilis baru DIHAPUS. Foto pelanggan
// yang disimpan di dalam docroot situs akan lenyap pada publish berikutnya. Karena itu
// media ditaruh di ruang terpisah `media/<tenantId>/`, sibling docroot situs, yang tak
// pernah tersentuh mirror.

import { createHash } from 'node:crypto';
import { err, ok } from '@digimaestro/shared';
import type { MediaError, MediaStorePort, Result, StoredMedia, TenantId } from '@digimaestro/shared';
import type { RemoteDeployClient } from '../publish/remote-deploy.js';

// Prefix media, relatif root FTP (= document root domain; lihat cpanel-deploy-target).
export const MEDIA_PREFIX = 'media';

export interface FtpsMediaStoreOptions {
  // Domain publik untuk menyusun URL (mis. 'digimaestro.id').
  readonly baseDomain: string;
  readonly prefix?: string;
}

export class FtpsMediaStore implements MediaStorePort {
  constructor(
    private readonly connect: () => RemoteDeployClient,
    private readonly options: FtpsMediaStoreOptions,
  ) {}

  async store(input: {
    readonly tenantId: TenantId;
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<Result<StoredMedia, MediaError>> {
    const prefix = this.options.prefix ?? MEDIA_PREFIX;
    const dir = `${prefix}/${input.tenantId}`;
    const key = `${dir}/${input.filename}`;

    const client = this.connect();
    try {
      await client.connect();
      await client.mkdirp(dir);
      await client.writeFile(key, input.bytes);
      await client.end();
    } catch (e) {
      // Tutup koneksi walau gagal, supaya sesi FTP tak menggantung di server.
      try {
        await client.end();
      } catch {
        /* koneksi memang sudah rusak */
      }
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'STORE', message: `gagal menyimpan media: ${message}` });
    }

    return ok({ key, url: `https://${this.options.baseDomain}/${key}` });
  }
}

// Nama file dari isi (content-addressed): foto identik → nama sama → tak menumpuk duplikat,
// dan URL-nya stabil (aman untuk cache lama).
export function mediaFilename(bytes: Uint8Array, contentType: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const ext = contentType === 'image/webp' ? 'webp' : 'bin';
  return `${hash}.${ext}`;
}
