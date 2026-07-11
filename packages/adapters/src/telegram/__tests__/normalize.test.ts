import { describe, expect, it } from 'vitest';
import { telegramUpdateSchema, toInboundMessage } from '../normalize.js';

function parse(raw: unknown) {
  const r = telegramUpdateSchema.safeParse(raw);
  if (!r.success) throw new Error(`schema menolak payload: ${r.error.message}`);
  return r.data;
}

describe('telegram normalize — teks', () => {
  it('pesan teks → InboundChannelMessage TEXT', () => {
    const msg = toInboundMessage(
      parse({
        update_id: 1,
        message: {
          message_id: 42,
          chat: { id: 8037867441 },
          from: { first_name: 'Darusman' },
          text: 'halo',
        },
      }),
    );

    expect(msg).toEqual({
      channel: 'TELEGRAM',
      externalId: '8037867441',
      providerMsgId: 'tg-8037867441-42',
      type: 'TEXT',
      text: 'halo',
      senderName: 'Darusman',
    });
  });

  // message_id hanya unik per-chat; providerMsgId unik GLOBAL di DB. Tanpa prefiks chat,
  // pesan #42 dari dua chat berbeda akan saling dianggap duplikat dan salah satunya
  // tak pernah dibalas.
  it('message_id sama dari chat berbeda → providerMsgId berbeda', () => {
    const a = toInboundMessage(
      parse({ update_id: 1, message: { message_id: 42, chat: { id: 111 }, text: 'a' } }),
    );
    const b = toInboundMessage(
      parse({ update_id: 2, message: { message_id: 42, chat: { id: 222 }, text: 'b' } }),
    );

    expect(a?.providerMsgId).not.toBe(b?.providerMsgId);
  });

  it('edited_message diperlakukan sebagai pesan', () => {
    const msg = toInboundMessage(
      parse({ update_id: 3, edited_message: { message_id: 7, chat: { id: 1 }, text: 'revisi' } }),
    );
    expect(msg?.text).toBe('revisi');
  });

  it('field asing dari Telegram tidak menggagalkan parsing', () => {
    const msg = toInboundMessage(
      parse({
        update_id: 4,
        message: { message_id: 8, chat: { id: 1, type: 'private' }, text: 'hai', fitur_baru: {} },
      }),
    );
    expect(msg?.type).toBe('TEXT');
  });
});

describe('telegram normalize — media & non-pesan', () => {
  it('foto → IMAGE + file_id resolusi TERBESAR', () => {
    const msg = toInboundMessage(
      parse({
        update_id: 5,
        message: {
          message_id: 9,
          chat: { id: 1 },
          caption: 'logo warung',
          photo: [{ file_id: 'kecil' }, { file_id: 'sedang' }, { file_id: 'besar' }],
        },
      }),
    );

    expect(msg?.type).toBe('IMAGE');
    expect(msg?.mediaRef).toBe('besar');
    expect(msg?.text).toBe('logo warung'); // caption jadi teks
  });

  it('dokumen → DOCUMENT, voice → AUDIO, lokasi → LOCATION', () => {
    const doc = toInboundMessage(
      parse({ update_id: 6, message: { message_id: 1, chat: { id: 1 }, document: { file_id: 'd1' } } }),
    );
    const voice = toInboundMessage(
      parse({ update_id: 7, message: { message_id: 2, chat: { id: 1 }, voice: { file_id: 'v1' } } }),
    );
    const loc = toInboundMessage(
      parse({
        update_id: 8,
        message: { message_id: 3, chat: { id: 1 }, location: { latitude: 1, longitude: 2 } },
      }),
    );

    expect(doc?.type).toBe('DOCUMENT');
    expect(voice?.type).toBe('AUDIO');
    expect(loc?.type).toBe('LOCATION');
  });

  // callback_query/my_chat_member/dll → bukan pesan. Harus null (webhook tetap 200).
  it('update bukan pesan → null', () => {
    expect(toInboundMessage(parse({ update_id: 9 }))).toBeNull();
  });

  it('payload tanpa update_id ditolak schema', () => {
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false);
  });
});
