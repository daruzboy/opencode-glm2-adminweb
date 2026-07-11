import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import type { InboundChannelMessage } from '@digimaestro/shared';
import {
  handleInboundMessage,
  inboundFallbackReply,
  unsupportedTypeReply,
  type InboundDeps,
} from './handle-inbound.js';

const TENANT = tenantId('t1');

const textMsg: InboundChannelMessage = {
  channel: 'TELEGRAM',
  externalId: '555',
  providerMsgId: 'tg-555-1',
  type: 'TEXT',
  text: 'halo, mau bikin website warung',
};

function conversationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    tenantId: 't1',
    channel: 'TELEGRAM',
    externalId: '555',
    state: 'ONBOARDING',
    escalatedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    tenantId: 't1',
    conversationId: 'c1',
    direction: 'IN',
    type: 'TEXT',
    text: 'x',
    mediaId: null,
    providerMsgId: 'tg-555-1',
    status: 'DELIVERED',
    createdAt: '',
    ...over,
  };
}

function fakeDeps(over: Partial<Record<'existing' | 'createMsg' | 'send' | 'reply', unknown>> = {}) {
  return {
    conversations: {
      findByExternalId: vi.fn(async () => ({
        ok: true as const,
        value: (over.existing ?? null) as never,
      })),
      create: vi.fn(async () => ({ ok: true as const, value: conversationRow() as never })),
    } as never,
    messages: {
      create:
        (over.createMsg as never) ??
        vi.fn(async () => ({ ok: true as const, value: messageRow() as never })),
    } as never,
    channel: {
      channel: 'TELEGRAM' as const,
      sendText:
        (over.send as never) ??
        vi.fn(async () => ({ ok: true as const, value: { providerMsgId: 'tg-555-2' } })),
    } as never,
    reply: (over.reply as never) ?? {
      reply: vi.fn(async () => ({ ok: true as const, value: { text: 'Siap! Nama usahanya apa?' } })),
    },
  } as unknown as InboundDeps;
}

describe('handleInboundMessage — kanal eksternal (T-030tg)', () => {
  it('chat baru → buat Conversation, balas agent, kirim ke kanal', async () => {
    const deps = fakeDeps();
    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.duplicate).toBe(false);
      expect(res.value.replyText).toBe('Siap! Nama usahanya apa?');
      expect(res.value.sent).toBe(true);
    }
    // Percakapan dibuat dgn externalId → pesan berikutnya nempel ke percakapan yang sama.
    expect(deps.conversations.create).toHaveBeenCalledWith(TENANT, {
      channel: 'TELEGRAM',
      externalId: '555',
    });
    expect(deps.channel.sendText).toHaveBeenCalledWith('555', 'Siap! Nama usahanya apa?');
  });

  it('percakapan sudah ada → dipakai ulang, tidak bikin baru', async () => {
    const deps = fakeDeps({ existing: conversationRow({ id: 'c-lama' }) });
    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.conversationId).toBe('c-lama');
    expect(deps.conversations.create).not.toHaveBeenCalled();
  });

  // Inti idempotensi (FR-CHN-005): Telegram mengirim ulang update saat kita lambat/5xx.
  it('providerMsgId sudah ada (CONFLICT) → duplikat: TIDAK membalas & TIDAK mengirim', async () => {
    const createMsg = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'CONFLICT' as const, message: 'sudah tercatat' },
    }));
    const reply = { reply: vi.fn() };
    const deps = fakeDeps({ createMsg, reply });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.duplicate).toBe(true);
    // Tidak ada balasan dobel ke pengguna, dan LLM tak dipanggil dua kali.
    expect(reply.reply).not.toHaveBeenCalled();
    expect(deps.channel.sendText).not.toHaveBeenCalled();
  });

  it('error DB sungguhan (UNKNOWN) → err (bukan diperlakukan duplikat)', async () => {
    const createMsg = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'UNKNOWN' as const, message: 'koneksi putus' },
    }));
    const res = await handleInboundMessage(fakeDeps({ createMsg }), {
      tenantId: TENANT,
      message: textMsg,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNKNOWN');
  });

  it('agent gagal → balasan fallback tetap terkirim (chat tak mati bisu)', async () => {
    const reply = {
      reply: vi.fn(async () => ({ ok: false as const, error: { code: 'AGENT' as const, message: 'timeout' } })),
    };
    const deps = fakeDeps({ reply });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    expect(deps.channel.sendText).toHaveBeenCalledWith('555', inboundFallbackReply());
  });

  it('pesan non-teks (foto) → dijawab jujur tanpa memanggil LLM', async () => {
    const reply = { reply: vi.fn() };
    const deps = fakeDeps({ reply });
    const photo: InboundChannelMessage = {
      channel: 'TELEGRAM',
      externalId: '555',
      providerMsgId: 'tg-555-9',
      type: 'IMAGE',
      mediaRef: 'file-abc',
    };

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: photo });

    expect(res.ok).toBe(true);
    expect(reply.reply).not.toHaveBeenCalled();
    expect(deps.channel.sendText).toHaveBeenCalledWith('555', unsupportedTypeReply());
  });

  it('kirim ke kanal gagal → pesan OUT dicatat FAILED (tidak mengaku terkirim)', async () => {
    const send = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'NETWORK' as const, message: 'telegram down' },
    }));
    const createMsg = vi.fn(async () => ({ ok: true as const, value: messageRow() as never }));
    const deps = fakeDeps({ send, createMsg });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sent).toBe(false);
    const outCall = createMsg.mock.calls.find(
      (c) => (c[1] as { direction: string }).direction === 'OUT',
    );
    expect((outCall?.[1] as { status: string }).status).toBe('FAILED');
  });
});

// Ditemukan saat uji NYATA (bot live): API key LLM kosong → agent gagal tiap pesan →
// pengguna hanya melihat "aku lagi tersendat" dan TAK ADA petunjuk apa pun di log.
describe('kegagalan agent harus terlihat di log (bukan senyap)', () => {
  it('agent gagal → sebab dicatat logger', async () => {
    const errors: string[] = [];
    const reply = {
      reply: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'AGENT' as const, message: 'API key kosong' },
      })),
    };
    const deps = fakeDeps({ reply });
    (deps as { logger?: unknown }).logger = { error: (m: string) => errors.push(m) };

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(errors.some((e) => e.includes('API key kosong'))).toBe(true);
  });

  it('replier tak disuntik → juga dicatat (salah konfigurasi, bukan "agent bodoh")', async () => {
    const errors: string[] = [];
    const deps = fakeDeps();
    (deps as { reply?: unknown }).reply = undefined;
    (deps as { logger?: unknown }).logger = { error: (m: string) => errors.push(m) };

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(errors.some((e) => e.includes('tidak disuntik'))).toBe(true);
  });
});

// T-033: foto pelanggan → ingest (unduh+optimasi+simpan), TANPA memanggil LLM.
describe('foto masuk (T-033)', () => {
  const photo = {
    channel: 'TELEGRAM' as const,
    externalId: '555',
    providerMsgId: 'tg-555-photo',
    type: 'IMAGE' as const,
    mediaRef: 'tg-file-abc',
  };

  it('foto → di-ingest & dikonfirmasi, LLM tidak dipanggil (hemat token)', async () => {
    const reply = { reply: vi.fn() };
    const deps = fakeDeps({ reply });
    (deps as { media?: unknown }).media = {
      ingest: vi.fn(async () => ({ ok: true, value: { url: 'https://x.id/media/t1/a.webp' } })),
      count: vi.fn(async () => 2),
    };

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: photo });

    expect(res.ok).toBe(true);
    expect(reply.reply).not.toHaveBeenCalled();
    const [, text] = (deps.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(text).toContain('Foto kesimpan');
    expect(text).toContain('2 foto');
  });

  it('ingest gagal → pesan jujur ke pengguna, sebabnya masuk log', async () => {
    const errors: string[] = [];
    const deps = fakeDeps();
    (deps as { logger?: unknown }).logger = { error: (m: string) => errors.push(m) };
    (deps as { media?: unknown }).media = {
      ingest: vi.fn(async () => ({ ok: false, error: { message: 'ftp putus' } })),
      count: vi.fn(async () => 0),
    };

    await handleInboundMessage(deps, { tenantId: TENANT, message: photo });

    const [, text] = (deps.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(text).toContain('gagal kuproses');
    expect(errors.some((e) => e.includes('ftp putus'))).toBe(true);
  });

  // Tanpa kredensial hosting, media deps tak dirakit → foto ditolak sopan, bot tetap hidup.
  it('media deps tak ada → jawab sopan, tak crash', async () => {
    const deps = fakeDeps();
    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: photo });

    expect(res.ok).toBe(true);
    const [, text] = (deps.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(text).toContain('teks dan foto');
  });
});

// DITEMUKAN SAAT BOT DIPAKAI SUNGGUHAN: agent membalas teks KOSONG → kita tetap mengirimnya
// → Telegram menolak ("message text is empty") → pesan OUT tercatat FAILED dan pengguna
// ditinggal BISU di tengah percakapan.
describe('balasan kosong tak pernah dikirim', () => {
  it('agent balas string kosong → fallback dipakai (bukan pesan kosong)', async () => {
    const reply = { reply: vi.fn(async () => ({ ok: true as const, value: { text: '' } })) };
    const deps = fakeDeps({ reply });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    const [, text] = (deps.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(text).toBe(inboundFallbackReply());
    expect(text.length).toBeGreaterThan(0);
  });

  it('balasan hanya spasi/baris baru → juga dianggap kosong', async () => {
    const reply = { reply: vi.fn(async () => ({ ok: true as const, value: { text: '  \n\n ' } })) };
    const deps = fakeDeps({ reply });

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    const [, text] = (deps.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// P0 (audit Telegram): rate limit LAMA hanya membungkus pesan KELUAR, sedangkan LLM dipanggil
// LEBIH DULU → anggaran token TIDAK terlindungi sama sekali. Gerbang ini menolak SEBELUM biaya.
describe('gerbang biaya pesan masuk (P0)', () => {
  function limiter(over: Partial<{ allowed: boolean; shouldWarn: boolean }> = {}) {
    return {
      check: vi.fn(async () => ({
        allowed: over.allowed ?? false,
        shouldWarn: over.shouldWarn ?? false,
        retryAfterSec: 60,
      })),
    };
  }

  it('melewati batas → LLM TIDAK dipanggil (inti perbaikannya)', async () => {
    const reply = { reply: vi.fn() };
    const deps = fakeDeps({ reply });
    (deps as { rateLimiter?: unknown }).rateLimiter = limiter({ allowed: false });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.rateLimited).toBe(true);
    // Token TIDAK terbakar.
    expect(reply.reply).not.toHaveBeenCalled();
  });

  it('peringatan dikirim sekali; pesan spam berikutnya DIAM (tak ikut membanjiri)', async () => {
    const deps1 = fakeDeps();
    (deps1 as { rateLimiter?: unknown }).rateLimiter = limiter({ allowed: false, shouldWarn: true });
    await handleInboundMessage(deps1, { tenantId: TENANT, message: textMsg });
    const [, warn] = (deps1.channel.sendText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(warn).toContain('kecepetan');

    const deps2 = fakeDeps();
    (deps2 as { rateLimiter?: unknown }).rateLimiter = limiter({ allowed: false, shouldWarn: false });
    await handleInboundMessage(deps2, { tenantId: TENANT, message: textMsg });
    expect(deps2.channel.sendText).not.toHaveBeenCalled();
  });

  it('di bawah batas → jalan normal (LLM dipanggil)', async () => {
    const reply = { reply: vi.fn(async () => ({ ok: true as const, value: { text: 'halo!' } })) };
    const deps = fakeDeps({ reply });
    (deps as { rateLimiter?: unknown }).rateLimiter = limiter({ allowed: true });

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(reply.reply).toHaveBeenCalled();
  });

  // Foto juga memakan biaya (unduh + sharp + FTP) → ikut dibatasi.
  it('foto juga lewat gerbang (unduh/optimasi tak dijalankan saat limit)', async () => {
    const deps = fakeDeps();
    const ingest = vi.fn();
    (deps as { media?: unknown }).media = { ingest, count: vi.fn(async () => 0) };
    (deps as { rateLimiter?: unknown }).rateLimiter = limiter({ allowed: false });

    await handleInboundMessage(deps, {
      tenantId: TENANT,
      message: { channel: 'TELEGRAM', externalId: '555', providerMsgId: 'p', type: 'IMAGE', mediaRef: 'f1' },
    });

    expect(ingest).not.toHaveBeenCalled();
  });

  // Tombol SENGAJA tak dibatasi: aksi diskrit, sudah idempoten, dan menahannya bikin UI menggantung.
  it('tombol TIDAK dibatasi laju', async () => {
    const deps = fakeDeps();
    const check = vi.fn();
    (deps as { rateLimiter?: unknown }).rateLimiter = { check };

    (deps.channel as { answerCallback?: unknown }).answerCallback = vi.fn(async () => ({ ok: true }));

    await handleInboundMessage(deps, {
      tenantId: TENANT,
      message: { channel: 'TELEGRAM', externalId: '555', providerMsgId: 'cb', type: 'INTERACTIVE', callbackId: 'c', callbackData: 'pub:1' },
    });

    expect(check).not.toHaveBeenCalled();
  });
});
