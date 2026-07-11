// T-053h: bersihkan "tool call yang ditulis sebagai teks" dari balasan model.
//
// Ditemukan saat uji bot NYATA: pengguna menerima pesan berisi markup mentah
//   <｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="sitebuilder_build_site">…
//
// Sebabnya: saat agent-loop mematikan tools (langkah terakhir, forceText) tapi prompt
// masih menyuruh memanggil tool, model tak punya saluran protokol → ia MENULISKAN
// pemanggilan tool ke `content`. Bentuknya beragam: markup internal DeepSeek (DSML),
// blok <tool_call> ala model lain, atau kalimat polos "Memanggil nama_tool(...)".
//
// Akar masalahnya diperbaiki di agent-loop (instruksi penutup saat tools dimatikan).
// Modul ini JARING PENGAMAN: apa pun yang model lakukan, markup vendor berhenti di
// adapter dan tak pernah sampai ke pengguna.

// ｜ = U+FF5C (fullwidth vertical line) yang dipakai penanda DSML DeepSeek — sengaja
// dicocokkan lewat escape agar tak bergantung pada encoding berkas ini.
const FW = '｜';

const MARKUP_PATTERNS: readonly RegExp[] = [
  // <｜｜DSML｜｜…> … blok apa pun bertanda DSML, termasuk penutupnya.
  new RegExp(`<\\s*${FW}*\\s*DSML[\\s\\S]*?>`, 'gi'),
  new RegExp(`</\\s*${FW}*\\s*DSML[\\s\\S]*?>`, 'gi'),
  // Blok <tool_call>…</tool_call> / <function_call>…</function_call> (model lain).
  /<\s*(tool_call|function_call|tool_calls|invoke)[\s\S]*?<\/\s*(tool_call|function_call|tool_calls|invoke)\s*>/gi,
  // Tag pembuka/penutup yang tersisa tanpa pasangan.
  /<\/?\s*(tool_call|function_call|tool_calls|invoke|parameter)\b[^>]*>/gi,
];

// Kalimat "aku panggil tool X(...)" — bukan markup, tapi tetap bocoran mekanisme internal
// yang tak berarti apa-apa bagi pemilik warung.
const NARRATED_CALL = /^\s*(memanggil|calling|panggil)\s+[a-z0-9_]+\s*\([^)]*\)\s*\.?\s*$/gim;

export function containsToolMarkup(text: string): boolean {
  if (text.includes(`${FW}${FW}`) || /DSML/i.test(text)) return true;
  return MARKUP_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

// Penanda AWAL blok tool-call yang ditulis sebagai teks.
const MARKUP_START = new RegExp(`<\\s*${FW}*\\s*DSML|<\\s*(tool_call|function_call|tool_calls|invoke)\\b`, 'i');

// Buang markup; rapikan sisa spasi/baris kosong. Bisa mengembalikan string kosong bila
// SELURUH balasan hanya markup — pemanggil harus memperlakukan itu sebagai balasan tak
// terpakai (bukan mengirim pesan kosong ke pengguna).
//
// Blok markup dipotong dari penanda pertama SAMPAI AKHIR teks, bukan sekadar menghapus
// tag-nya. Alasannya: markup yang bocor sering tak berpasangan rapi, dan menghapus tag saja
// menyisakan potongan argumen ("Sate Pak Dar") yang tampak seperti kalimat padahal bukan —
// itu akan lolos sebagai "balasan sah" dan tetap membingungkan pengguna. Model menulis
// kalimatnya SEBELUM markup, jadi memotong ke belakang menjaga bagian yang memang untuk
// pengguna dan membuang sisanya tanpa menebak-nebak.
export function stripToolMarkup(text: string): string {
  const start = text.search(MARKUP_START);
  let out = start >= 0 ? text.slice(0, start) : text;

  // Sisa tag lepas (mis. penutup tanpa pembuka) tetap dibersihkan.
  for (const re of MARKUP_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, ' ');
  }
  out = out.replace(NARRATED_CALL, ' ');

  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
