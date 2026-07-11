// T-030tg: allowlist chat Telegram → tenant.
//
// Bot Telegram itu TERBUKA: siapa pun yang menemukan @username-nya bisa mengirim pesan.
// Tanpa gerbang, orang asing bisa memicu panggilan LLM dan membakar anggaran token.
// Fase 0 karenanya memakai allowlist: hanya chat_id terdaftar yang dilayani; sisanya
// ditolak SEBELUM LLM tersentuh. Self-serve (auto-provision tenant + kuota) menyusul.
//
// Format env: "<chat_id>:<tenantId>[,<chat_id>:<tenantId>...]"
//   TELEGRAM_ALLOWLIST="8037867441:clx123abc,99887766:clx456def"
// Chat_id di sini bukan rahasia (tenantId juga bukan) → aman di env, bukan kredensial.

// Baris cacat dilewati, bukan menggagalkan seluruh allowlist: satu typo tidak boleh
// mematikan bot untuk semua tenant lain. Entri terakhir menang bila chat_id ganda.
export function parseTelegramAllowlist(raw: string | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue; // tanpa ':' atau chat_id kosong → abaikan
    const chatId = trimmed.slice(0, sep).trim();
    const tenant = trimmed.slice(sep + 1).trim();
    if (chatId.length === 0 || tenant.length === 0) continue;

    map.set(chatId, tenant);
  }
  return map;
}

// null = chat tidak dikenal → JANGAN panggil LLM, jangan buat tenant.
export function resolveTenantForChat(
  allowlist: ReadonlyMap<string, string>,
  chatId: string,
): string | null {
  return allowlist.get(chatId) ?? null;
}
