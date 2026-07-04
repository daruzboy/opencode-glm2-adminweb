// T-052: state machine percakapan (FR-CNV-001). Murni, tanpa I/O: memetakan
// (ConversationState sekarang, Intent pesan) → (state berikutnya, aksi handler).
// State berikut mungkin sama dengan sekarang (status/other tidak mengubah fase).
// Tabel transisi = keputusan produk v0 (dirancang ekstensible: tambah (state,intent)
// di SWITCH bawah). Lapis router memakai ini untuk persist state antar sesi.

import type { ConversationState } from '@digimaestro/shared';
import type { Intent } from './intent.js';

// Aksi yang harus dijalankan handler terkait (FR-CNV-002 routing). Handler nyata
// hadir di use case AGT/NTF/ADM berikutnya; router v0 hanya menetapkan aksi.
export type RouterAction =
  | 'START_INTERVIEW' // mulai/melanjutkan wawancara (slot-filling, FR-CNV-003)
  | 'HANDLE_REVISION' // alur revisi (FR-AGT-004)
  | 'REPORT_STATUS' // jawab status berbasis job aktual (FR-CNV-005)
  | 'FALLBACK'; // belum ada handler / di luar lingkup (FR-CNV-008)

export interface StateTransition {
  readonly state: ConversationState;
  readonly action: RouterAction;
}

// Tabel transisi v0. Aturan:
// - interview: masuk/melanjutkan fase INTERVIEW (kecuali sedang BUILDING aktif →
//   tetap INTERVIEW agar pengguna bisa menambah info sembari build berjalan).
// - revision: hanya sah bila sudah ada situs (REVIEW/BUILDING). Tanpa situs →
//   pertahankan state, handler membimbing ke wawancara (FALLBACK).
// - status: pertanyaan transien → state tak berubah, handler laporkan status.
// - other: tak relevan → state tak berubah, handler fallback (ucapan/escalamasi
//   "mau bicara manusia" ditangani lapis ADM FR-CNV-006/007 di iterasi berikutnya).
export function advanceState(current: ConversationState, intent: Intent): StateTransition {
  switch (intent) {
    case 'interview':
      return { state: 'INTERVIEW', action: 'START_INTERVIEW' };

    case 'revision':
      if (current === 'BUILDING' || current === 'REVIEW') {
        return { state: 'REVIEW', action: 'HANDLE_REVISION' };
      }
      return { state: current, action: 'FALLBACK' };

    case 'status':
      return { state: current, action: 'REPORT_STATUS' };

    case 'other':
      return { state: current, action: 'FALLBACK' };
  }
}
