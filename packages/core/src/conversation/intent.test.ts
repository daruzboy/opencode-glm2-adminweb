import { describe, expect, it } from 'vitest';
import { err, ok, tenantId, type LlmJsonPort, type LlmJsonRequest } from '@digimaestro/shared';
import {
  classifyIntent,
  classifyIntentKeyword,
  type Intent,
} from './intent.js';

// Fake LlmJsonPort meniru adapter deterministik (responder → schema.safeParse)
// tanpa mengimpor @digimaestro/adapters (dependency rule: core → shared saja).
function makeFakeLlm<T>(responder: (req: LlmJsonRequest<T>) => unknown): LlmJsonPort {
  return {
    name: 'llm:fake',
    async completeJson(request: LlmJsonRequest<T>) {
      const parsed = request.schema.safeParse(responder(request));
      if (!parsed.success) {
        return err({
          code: 'INVALID_SCHEMA',
          message: parsed.error.message,
          retryable: false,
          attempt: 1,
        });
      }
      return ok(parsed.data);
    },
  };
}

// Kriteria terima T-052 (backlog): 20 kalimat uji terklasifikasi ≥ 90% benar.
const CASES: ReadonlyArray<{ text: string; intent: Intent }> = [
  // interview — mau buat / wawancara / isi data usaha
  { text: 'Saya mau buat website untuk warung saya', intent: 'interview' },
  { text: 'Gimana cara mulai bikin situs?', intent: 'interview' },
  { text: 'Nama usaha saya Warung Bu Tini', intent: 'interview' },
  { text: 'Saya ingin daftar, mau punya web', intent: 'interview' },
  { text: 'Bisa bantu buatkan website?', intent: 'interview' },
  { text: 'Butuh web untuk toko kelontong saya', intent: 'interview' },
  // revision — minta perubahan situs
  { text: 'Tolong ganti foto hero-nya', intent: 'revision' },
  { text: 'Ubah warna jadi biru dong', intent: 'revision' },
  { text: 'Revisi bagian tentang kami', intent: 'revision' },
  { text: 'Tambah halaman kontak ya', intent: 'revision' },
  { text: 'Hapus menu makanan yang lama', intent: 'revision' },
  { text: 'Edit teks di halaman utama', intent: 'revision' },
  // status — tanya progres
  { text: 'Sampai mana websitenya?', intent: 'status' },
  { text: 'Kapan selesai nih?', intent: 'status' },
  { text: 'Gimana progresnya?', intent: 'status' },
  { text: 'Udah jadi belum ya?', intent: 'status' },
  { text: 'Cek status job saya dong', intent: 'status' },
  // other — di luar tiga kelas di atas
  { text: 'Halo, selamat pagi', intent: 'other' },
  { text: 'Makasih ya bantuannya', intent: 'other' },
  { text: 'Tolong sambungkan ke manusia', intent: 'other' },
];

describe('classifyIntentKeyword — aturan frasa murni (deterministik)', () => {
  it('memetakan frasa yang dikenal ke intent (interview/revision/status)', () => {
    const nonOther = CASES.filter((c) => c.intent !== 'other');
    for (const c of nonOther) {
      expect(classifyIntentKeyword(c.text)).toBe(c.intent);
    }
  });

  it('mengembalikan null untuk teks tanpa frasa dikenal (contract: null ≠ other)', () => {
    const others = CASES.filter((c) => c.intent === 'other');
    for (const c of others) {
      expect(classifyIntentKeyword(c.text)).toBeNull();
    }
  });

  it('normalisasi: case-insensitive & whitespace berlebih', () => {
    expect(classifyIntentKeyword('  ToLoNg   GANTI   foto  ')).toBe('revision');
  });

  it('prioritas: frasa revision/status menang atas interview', () => {
    // "ganti" menang atas kata umum; tak boleh tertangkap sebagai interview.
    expect(classifyIntentKeyword('mau ganti tema')).toBe('revision');
  });
});

describe('classifyIntent — 20 kalimat uji ≥ 90% benar (kriteria terima T-052)', () => {
  it('hybrid tanpa LLM (null → other) mencapai target', async () => {
    // classifyIntent membungkus keyword: null dipetakan ke 'other' ketika tanpa LLM.
    const wrong: string[] = [];
    for (const c of CASES) {
      const r = await classifyIntent({}, { tenantId: tenantId('tA'), text: c.text });
      const got = r.ok ? r.value : '<error>';
      if (got !== c.intent) wrong.push(`exp=${c.intent} got=${got} :: ${c.text}`);
    }
    expect(wrong.length).toBeLessThanOrEqual(Math.floor(CASES.length * 0.1));
    expect(wrong).toHaveLength(0);
  });
});

describe('classifyIntent — hybrid keyword → LLM', () => {
  it('keyword hit → tidak memanggil LLM', async () => {
    let called = false;
    const llm = makeFakeLlm(() => {
      called = true;
      return { intent: 'other' };
    });
    const r = await classifyIntent({ llm }, { tenantId: tenantId('tA'), text: 'revisi header' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('revision');
    expect(called).toBe(false);
  });

  it('keyword null & tanpa LLM → default other', async () => {
    const r = await classifyIntent({}, { tenantId: tenantId('tA'), text: 'rekomendasi film' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('other');
  });

  it('keyword null & LLM sukses → pakai hasil LLM', async () => {
    const llm = makeFakeLlm(() => ({ intent: 'status' }));
    const r = await classifyIntent({ llm }, { tenantId: tenantId('tA'), text: 'film terbaru' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('status');
  });

  it('LLM mengembalikan intent invalid → Result.err (schema reject)', async () => {
    const llm = makeFakeLlm(() => ({ intent: 'bogus' }));
    const r = await classifyIntent({ llm }, { tenantId: tenantId('tA'), text: 'film terbaru' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LLM');
  });
});
