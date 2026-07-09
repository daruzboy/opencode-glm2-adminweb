// packages/sites-kit/render — util escaping HTML untuk renderer statis (T-061).
// Konten Site Document berasal dari agent/klien → SELALU di-escape sebelum masuk HTML
// (anti-XSS). Renderer menghasilkan situs statis zero-JS (ADR-3), jadi tak ada sanitasi
// runtime di sisi klien; escaping saat build adalah pertahanan utama.

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape teks untuk konten elemen HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Escape untuk nilai atribut (dibungkus tanda kutip ganda oleh pemanggil). */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

// Skema URL yang diizinkan pada atribut href/src. `javascript:`, `data:`, `vbscript:`
// ditolak → dikembalikan '#'. URL relatif & anchor diizinkan.
const SAFE_URL_SCHEME = /^(https?:|mailto:|tel:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Kembalikan URL aman untuk href/src; blok skema berbahaya. */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '#';
  // URL berskema: hanya izinkan daftar aman.
  if (HAS_SCHEME.test(trimmed)) {
    return SAFE_URL_SCHEME.test(trimmed) ? trimmed : '#';
  }
  // Tanpa skema = relatif / anchor / path → aman.
  return trimmed;
}
