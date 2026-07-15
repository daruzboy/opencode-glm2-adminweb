// Konsol admin via chat (PO 2026-07-15): perintah deterministik `/konsumen …` — TANPA
// LLM (murah, tak bisa salah paham), dieksekusi worker SEBELUM handleInboundMessage.
//
// Alur pakai:
//   /konsumen daftar          → daftar konsumen (+ tanda yang sedang aktif)
//   /konsumen baru <nama>     → buat konsumen baru + langsung aktif
//   /konsumen pilih <slug>    → bertindak sebagai konsumen itu
//   /konsumen siapa           → sedang bertindak sebagai siapa
//   /konsumen selesai         → kembali ke tenant admin sendiri
//
// Setelah memilih: SEMUA pesan admin diproses sebagai tenant konsumen itu (resolver
// tenant menimpa binding), sehingga wawancara/build/preview/tombol bekerja apa adanya
// dan notifikasi mendarat di chat admin.

import { ok } from '@digimaestro/shared';
import type { ActingStorePort, AdminDirectoryPort, Result } from '@digimaestro/shared';

export interface AdminConsoleDeps {
  readonly directory: AdminDirectoryPort;
  readonly acting: ActingStorePort;
  // chat_id admin — SATU-SATUNYA chat yang boleh memakai konsol ini.
  readonly adminChatId: string;
}

export interface AdminCommandRequest {
  readonly chatId: string;
  readonly text: string;
}

// null = bukan perintah konsol admin (silakan proses sebagai chat biasa).
export type AdminCommandOutcome = { readonly reply: string } | null;

const HELP = [
  '🛠️ Konsol admin — perintah:',
  '/konsumen daftar — daftar semua konsumen',
  '/konsumen baru <nama usaha> — buat konsumen baru + langsung aktif',
  '/konsumen pilih <slug> — bertindak sebagai konsumen itu',
  '/konsumen siapa — cek sedang sebagai siapa',
  '/konsumen selesai — kembali ke akun admin sendiri',
].join('\n');

export function isAdminCommand(text: string | null | undefined): boolean {
  return Boolean(text && text.trim().toLowerCase().startsWith('/konsumen'));
}

export async function handleAdminCommand(
  deps: AdminConsoleDeps,
  req: AdminCommandRequest,
): Promise<Result<AdminCommandOutcome, never>> {
  // Bukan admin / bukan perintah → bukan urusan konsol (fail-closed: perintah dari chat
  // lain diperlakukan sebagai teks biasa — TIDAK membocorkan keberadaan konsol).
  if (req.chatId !== deps.adminChatId || !isAdminCommand(req.text)) return ok(null);

  const rest = req.text.trim().slice('/konsumen'.length).trim();
  const [verb, ...argParts] = rest.split(/\s+/);
  const arg = argParts.join(' ').trim();

  switch ((verb ?? '').toLowerCase()) {
    case 'daftar':
      return ok({ reply: await listReply(deps, req.chatId) });
    case 'baru':
      return ok({ reply: await createReply(deps, req.chatId, arg) });
    case 'pilih':
      return ok({ reply: await pickReply(deps, req.chatId, arg.toLowerCase()) });
    case 'siapa':
      return ok({ reply: await whoReply(deps, req.chatId) });
    case 'selesai':
      await deps.acting.clear(req.chatId);
      return ok({ reply: '✅ Selesai — pesan berikutnya kembali sebagai akun admin sendiri.' });
    default:
      return ok({ reply: HELP });
  }
}

async function listReply(deps: AdminConsoleDeps, chatId: string): Promise<string> {
  const res = await deps.directory.list();
  if (!res.ok) return `⚠️ Gagal memuat daftar: ${res.error.message}`;
  if (res.value.length === 0) return 'Belum ada konsumen. Buat dengan: /konsumen baru <nama usaha>';

  const active = await deps.acting.get(chatId);
  const rows = res.value.map((c) => {
    const situs = c.websiteSlug ? `situs: ${c.websiteSlug} (${c.websiteStatus ?? '?'})` : 'belum ada situs';
    const mark = c.tenantId === active ? ' ← AKTIF' : '';
    return `• ${c.name} — slug: ${c.slug} — ${situs}${mark}`;
  });
  return [`👥 Konsumen (${res.value.length}):`, ...rows, '', 'Pilih: /konsumen pilih <slug>'].join('\n');
}

async function createReply(deps: AdminConsoleDeps, chatId: string, name: string): Promise<string> {
  if (!name) return 'Format: /konsumen baru <nama usaha>';
  const created = await deps.directory.create(name);
  if (!created.ok) return `⚠️ Gagal membuat konsumen: ${created.error.message}`;
  await deps.acting.set(chatId, created.value.tenantId);
  return (
    `✅ Konsumen "${created.value.name}" dibuat (slug: ${created.value.slug}) dan langsung AKTIF.\n` +
    'Mulai saja: ceritakan usahanya, nanti kubangun situsnya. Selesai? /konsumen selesai'
  );
}

async function pickReply(deps: AdminConsoleDeps, chatId: string, slug: string): Promise<string> {
  if (!slug) return 'Format: /konsumen pilih <slug> (lihat /konsumen daftar)';
  const found = await deps.directory.findBySlug(slug);
  if (!found.ok) return `⚠️ ${found.error.message}`;
  if (!found.value) return `Konsumen dengan slug "${slug}" tidak ditemukan. Cek /konsumen daftar`;
  await deps.acting.set(chatId, found.value.tenantId);
  return (
    `✅ Sekarang bertindak sebagai "${found.value.name}" (${found.value.slug}).\n` +
    'Semua pesanmu berikutnya = atas nama konsumen ini. Kembali: /konsumen selesai'
  );
}

async function whoReply(deps: AdminConsoleDeps, chatId: string): Promise<string> {
  const active = await deps.acting.get(chatId);
  if (!active) return 'Sedang sebagai AKUN ADMIN sendiri (tanpa konsumen aktif).';
  const list = await deps.directory.list();
  const found = list.ok ? list.value.find((c) => c.tenantId === active) : undefined;
  return found
    ? `Sedang bertindak sebagai "${found.name}" (${found.slug}).`
    : 'Sedang bertindak sebagai tenant yang sudah TIDAK ADA — jalankan /konsumen selesai.';
}
