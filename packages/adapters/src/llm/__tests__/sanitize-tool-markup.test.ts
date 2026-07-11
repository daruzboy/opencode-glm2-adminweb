import { describe, expect, it } from 'vitest';
import { containsToolMarkup, stripToolMarkup } from '../sanitize-tool-markup.js';

// Bocoran NYATA yang diterima pengguna di Telegram (uji bot live).
const DSML_LEAK =
  '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="sitebuilder_build_site"> ' +
  '<｜｜DSML｜｜parameter name="businessName" string="true">Sate Pak Dar</｜｜DSML｜｜parameter>';

describe('containsToolMarkup — kenali tool call yang ditulis sebagai teks', () => {
  it('markup DSML DeepSeek → terdeteksi', () => {
    expect(containsToolMarkup(DSML_LEAK)).toBe(true);
  });

  it('blok <tool_call> (model lain) → terdeteksi', () => {
    expect(containsToolMarkup('<tool_call>{"name":"x"}</tool_call>')).toBe(true);
  });

  it('teks normal → TIDAK dianggap markup (jangan merusak balasan sah)', () => {
    expect(containsToolMarkup('Situsmu sudah jadi! Mau publish sekarang?')).toBe(false);
    // Menyebut nama tool dalam kalimat wajar bukan markup.
    expect(containsToolMarkup('Aku pakai template hero untuk beranda ya.')).toBe(false);
  });
});

describe('stripToolMarkup — markup tak pernah sampai ke pengguna', () => {
  it('markup DSML dibuang sampai habis', () => {
    const out = stripToolMarkup(DSML_LEAK);

    expect(out).not.toContain('DSML');
    expect(out).not.toContain('invoke name');
    // Yang tersisa hanya isi argumen (kalau ada), bukan markup mesin.
    expect(containsToolMarkup(out)).toBe(false);
  });

  it('teks sah + markup → teks sahnya dipertahankan', () => {
    const out = stripToolMarkup(`Oke, aku bangun sekarang ya!\n${DSML_LEAK}`);

    expect(out).toContain('Oke, aku bangun sekarang ya!');
    expect(out).not.toContain('DSML');
  });

  it('kalimat "Memanggil nama_tool(...)" ikut dibuang (bocoran mekanisme internal)', () => {
    const out = stripToolMarkup(
      'Siap, aku buatkan sekarang.\nMemanggil sitebuilder_build_site(businessName="Sate Pak Dar")',
    );

    expect(out).toContain('Siap, aku buatkan sekarang.');
    expect(out).not.toContain('sitebuilder_build_site');
  });

  // Kalau SELURUH balasan cuma markup, tak ada yang layak dikirim → adapter harus
  // memperlakukannya sebagai error, bukan mengirim pesan kosong.
  it('balasan yang isinya hanya markup → string kosong', () => {
    expect(stripToolMarkup('<tool_call>{"name":"x"}</tool_call>')).toBe('');
  });

  it('teks normal tidak diubah', () => {
    const teks = 'Situsmu sudah jadi 🎉\n\nMau aku publish?';
    expect(stripToolMarkup(teks)).toBe(teks);
  });
});
