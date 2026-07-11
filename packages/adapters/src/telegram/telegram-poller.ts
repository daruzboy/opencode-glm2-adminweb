// T-030tg-poll: ambil update Telegram via long-polling (getUpdates) — alternatif webhook.
//
// Kenapa ada: webhook menuntut endpoint HTTPS PUBLIK. VPS Fase 0 tertutup (tak ada domain
// yang mengarah ke sana, port 80/443 belum dibuka), jadi Telegram tak bisa memanggil kita.
// Polling membalik arahnya: KITA yang menghubungi Telegram → bot hidup tanpa DNS/TLS/port
// terbuka. Webhook TETAP ada (apps/api) dan jadi jalur produksi begitu domain siap.
//
// Jalur pemrosesan sesudah ini SAMA PERSIS dengan webhook: normalisasi → allowlist →
// antrean `chat-inbound` → worker. Jadi tak ada cabang logika kedua yang bisa menyimpang.

import { parseTelegramAllowlist, resolveTenantForChat } from './allowlist.js';
import { telegramUpdateSchema, toInboundMessage } from './normalize.js';
import type { ChatInboundQueuePort } from '@digimaestro/shared';
import type { RuntimeFetch } from '../llm/openai-compatible-json-adapter.js';

const TELEGRAM_API = 'https://api.telegram.org';
// Long-poll: Telegram menahan koneksi sampai ada update atau timeout ini habis → nyaris
// realtime tanpa membanjiri API dengan permintaan kosong.
const DEFAULT_POLL_TIMEOUT_SEC = 30;

// P0 (audit): margin di atas long-poll. TANPA timeout eksplisit, `fetch` menggantung sampai
// default undici (±5 MENIT) bila koneksi stall (TCP hidup tapi tak ada respons) → bot
// BERHENTI menerima pesan, tanpa error, tanpa log, container tetap "sehat". Pola bug yang
// sama dengan worker-stub: tampak hidup, tapi tak bekerja.
const POLL_TIMEOUT_MARGIN_MS = 10_000;

export interface TelegramPollerOptions {
  readonly botToken: string;
  readonly queue: ChatInboundQueuePort;
  readonly fetch: RuntimeFetch;
  readonly allowlistRaw?: string;
  readonly baseUrl?: string;
  readonly pollTimeoutSec?: number;
  readonly logger?: { info(m: string): void; error(m: string): void };
}

export interface PollOutcome {
  // Offset berikutnya (= update_id terakhir + 1). Telegram menganggap update <offset
  // sudah diproses dan berhenti mengirimkannya.
  readonly nextOffset: number;
  readonly enqueued: number;
  readonly ignored: number;
}

// Satu putaran polling. Dipisah dari loop → teruji tanpa timer/jaringan nyata.
export async function pollOnce(
  options: TelegramPollerOptions,
  offset: number,
): Promise<PollOutcome> {
  const base = options.baseUrl ?? TELEGRAM_API;
  const timeout = options.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC;
  const allowlist = parseTelegramAllowlist(options.allowlistRaw);

  const res = await options.fetch(`${base}/bot${options.botToken}/getUpdates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      offset,
      timeout,
      // Hanya jenis update yang kita pahami — sisanya tak perlu dikirim Telegram.
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    }),
    // Timeout > long-poll: koneksi stall diputus & loop dilanjutkan (bukan menggantung).
    signal: AbortSignal.timeout(timeout * 1000 + POLL_TIMEOUT_MARGIN_MS),
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`getUpdates HTTP ${res.status}`);
  }

  const body = (await res.json()) as { ok?: boolean; description?: string; result?: unknown[] };
  if (body.ok !== true || !Array.isArray(body.result)) {
    throw new Error(`getUpdates ditolak: ${body.description ?? 'respons tak terduga'}`);
  }

  let nextOffset = offset;
  let enqueued = 0;
  let ignored = 0;

  for (const raw of body.result) {
    const parsed = telegramUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      ignored++;
      continue;
    }
    // Offset maju MESKI update diabaikan — kalau tidak, satu update yang tak kita pahami
    // akan dikirim ulang selamanya dan bot macet di situ.
    nextOffset = Math.max(nextOffset, parsed.data.update_id + 1);

    const message = toInboundMessage(parsed.data);
    if (!message) {
      ignored++;
      continue;
    }

    // Gerbang biaya yang sama dengan webhook (ADR-12): chat asing tak menyentuh LLM.
    const tenant = resolveTenantForChat(allowlist, message.externalId);
    if (!tenant) {
      options.logger?.info(`[telegram-poll] chat ${message.externalId} di luar allowlist — diabaikan`);
      ignored++;
      continue;
    }

    const added = await options.queue.enqueueInbound({ tenantId: tenant, message });
    if (!added.ok) {
      // Redis tersendat: JANGAN majukan offset melewati update ini, supaya Telegram
      // mengirimkannya lagi di putaran berikutnya (pesan pengguna tak boleh hilang).
      options.logger?.error(`[telegram-poll] gagal enqueue: ${added.error.message}`);
      return { nextOffset: parsed.data.update_id, enqueued, ignored };
    }
    enqueued++;
  }

  return { nextOffset, enqueued, ignored };
}

export interface PollerHandle {
  stop(): void;
}

// Loop long-polling. Offset disimpan di MEMORI: kalau proses restart, Telegram mungkin
// mengirim ulang update yang sempat diproses — dan itu aman, karena dedup providerMsgId
// @unique menahannya di lapis DB (FR-CHN-005).
export function startTelegramPoller(options: TelegramPollerOptions): PollerHandle {
  const logger = options.logger ?? console;
  let offset = 0;
  let running = true;

  const loop = async (): Promise<void> => {
    logger.info('[telegram-poll] mulai long-polling getUpdates');
    while (running) {
      try {
        const out = await pollOnce(options, offset);
        offset = out.nextOffset;
        if (out.enqueued > 0) {
          logger.info(`[telegram-poll] ${out.enqueued} pesan masuk antrean`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[telegram-poll] error: ${msg} — coba lagi 5 dtk`);
        await sleep(5_000);
      }
    }
    logger.info('[telegram-poll] berhenti');
  };

  void loop();
  return {
    stop(): void {
      running = false;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
