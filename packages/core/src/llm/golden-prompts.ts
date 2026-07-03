// T-050: golden set 20 brief usaha untuk evaluasi konsisten DeepSeek vs GLM.
// Data ini murni domain/evaluasi; runner provider hidup di composition/adapters.

export interface LlmGoldenPrompt {
  readonly id: string;
  readonly persona: 'umkm-owner' | 'operator';
  readonly industry: string;
  readonly prompt: string;
  readonly expectedSections: readonly string[];
  readonly requiredSignals: readonly string[];
}

export const LLM_GOLDEN_PROMPTS: readonly LlmGoldenPrompt[] = Object.freeze([
  {
    id: 'gp-001-warung-bakso',
    persona: 'umkm-owner',
    industry: 'kuliner',
    prompt: 'Saya punya warung bakso dekat kampus. Butuh website sederhana untuk menu, lokasi, dan pesanan WhatsApp.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'Kontak+Peta', 'Footer'],
    requiredSignals: ['nama usaha', 'menu', 'lokasi', 'WhatsApp'],
  },
  {
    id: 'gp-002-laundry-kiloan',
    persona: 'umkm-owner',
    industry: 'jasa laundry',
    prompt: 'Laundry kiloan rumahan ingin tampil profesional. Ada layanan antar jemput, paket express, dan area layanan sekitar Bekasi.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'Keunggulan', 'Kontak+Peta'],
    requiredSignals: ['antar jemput', 'express', 'area layanan'],
  },
  {
    id: 'gp-003-bengkel-motor',
    persona: 'umkm-owner',
    industry: 'otomotif',
    prompt: 'Bengkel motor kecil melayani servis rutin, ganti oli, dan tune up. Targetnya pelanggan sekitar komplek.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'Keunggulan', 'Testimoni'],
    requiredSignals: ['servis rutin', 'ganti oli', 'tune up'],
  },
  {
    id: 'gp-004-klinik-gigi',
    persona: 'umkm-owner',
    industry: 'kesehatan',
    prompt: 'Klinik gigi keluarga perlu website untuk profil dokter, layanan scaling, tambal gigi, dan booking konsultasi.',
    expectedSections: ['Hero', 'Tentang Kami', 'Layanan/Produk Grid', 'FAQ'],
    requiredSignals: ['dokter', 'booking', 'layanan gigi'],
  },
  {
    id: 'gp-005-katering-harian',
    persona: 'umkm-owner',
    industry: 'katering',
    prompt: 'Katering harian untuk kantor dan kos-kosan. Ingin menonjolkan menu mingguan, harga paket, dan testimoni.',
    expectedSections: ['Hero', 'Katalog Produk', 'Testimoni', 'FAQ'],
    requiredSignals: ['menu mingguan', 'harga paket', 'testimoni'],
  },
  {
    id: 'gp-006-kursus-bahasa',
    persona: 'umkm-owner',
    industry: 'pendidikan',
    prompt: 'Tempat kursus bahasa Inggris untuk anak SD-SMP. Ada kelas kecil, guru berpengalaman, dan trial gratis.',
    expectedSections: ['Hero', 'Tentang Kami', 'Layanan/Produk Grid', 'CTA Banner'],
    requiredSignals: ['kelas kecil', 'guru', 'trial gratis'],
  },
  {
    id: 'gp-007-toko-bunga',
    persona: 'umkm-owner',
    industry: 'retail bunga',
    prompt: 'Toko bunga menerima buket wisuda, papan ucapan, dan dekorasi lamaran. Butuh galeri dan tombol pesan cepat.',
    expectedSections: ['Hero', 'Galeri', 'Katalog Produk', 'Kontak+Peta'],
    requiredSignals: ['buket', 'papan ucapan', 'galeri', 'pesan cepat'],
  },
  {
    id: 'gp-008-jasa-foto',
    persona: 'umkm-owner',
    industry: 'fotografi',
    prompt: 'Fotografer freelance ingin portfolio untuk prewedding, acara keluarga, dan foto produk UMKM.',
    expectedSections: ['Hero', 'Galeri', 'Layanan/Produk Grid', 'Testimoni'],
    requiredSignals: ['portfolio', 'prewedding', 'foto produk'],
  },
  {
    id: 'gp-009-salon-muslimah',
    persona: 'umkm-owner',
    industry: 'salon',
    prompt: 'Salon muslimah menyediakan potong rambut, creambath, facial, dan paket bridal rumahan khusus perempuan.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'FAQ', 'Kontak+Peta'],
    requiredSignals: ['muslimah', 'khusus perempuan', 'paket bridal'],
  },
  {
    id: 'gp-010-toko-roti',
    persona: 'umkm-owner',
    industry: 'bakery',
    prompt: 'Toko roti artisan menjual sourdough, pastry, dan hampers. Ingin ada katalog dan info pre-order.',
    expectedSections: ['Hero', 'Katalog Produk', 'Keunggulan', 'FAQ'],
    requiredSignals: ['sourdough', 'hampers', 'pre-order'],
  },
  {
    id: 'gp-011-jasa-ac',
    persona: 'umkm-owner',
    industry: 'jasa teknisi',
    prompt: 'Jasa service AC panggilan untuk cuci AC, isi freon, bongkar pasang. Area Jakarta Selatan.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'Keunggulan', 'Kontak+Peta'],
    requiredSignals: ['panggilan', 'cuci AC', 'isi freon', 'Jakarta Selatan'],
  },
  {
    id: 'gp-012-petshop',
    persona: 'umkm-owner',
    industry: 'petshop',
    prompt: 'Petshop kecil menjual makanan kucing, pasir, aksesoris, dan grooming. Pelanggan sering tanya jadwal grooming.',
    expectedSections: ['Hero', 'Katalog Produk', 'FAQ', 'Kontak+Peta'],
    requiredSignals: ['makanan kucing', 'grooming', 'jadwal'],
  },
  {
    id: 'gp-013-kontraktor-renovasi',
    persona: 'umkm-owner',
    industry: 'konstruksi',
    prompt: 'Jasa renovasi rumah ingin tampil terpercaya. Ada portofolio dapur, kamar mandi, dan kanopi.',
    expectedSections: ['Hero', 'Galeri', 'Keunggulan', 'Testimoni'],
    requiredSignals: ['renovasi', 'portofolio', 'terpercaya'],
  },
  {
    id: 'gp-014-toko-batik',
    persona: 'umkm-owner',
    industry: 'fashion',
    prompt: 'Toko batik lokal menjual kemeja, dress, dan seragam kantor. Ingin website bernuansa elegan Indonesia.',
    expectedSections: ['Hero', 'Katalog Produk', 'Tentang Kami', 'CTA Banner'],
    requiredSignals: ['batik', 'seragam kantor', 'elegan Indonesia'],
  },
  {
    id: 'gp-015-kopi-keliling',
    persona: 'umkm-owner',
    industry: 'minuman',
    prompt: 'Brand kopi keliling dengan gerobak modern. Butuh jadwal lokasi harian, menu kopi susu, dan paket event.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'FAQ', 'Kontak+Peta'],
    requiredSignals: ['jadwal lokasi', 'kopi susu', 'paket event'],
  },
  {
    id: 'gp-016-daycare',
    persona: 'umkm-owner',
    industry: 'penitipan anak',
    prompt: 'Daycare rumahan menerima anak usia 2-6 tahun, ada aktivitas belajar, makan siang, dan laporan harian.',
    expectedSections: ['Hero', 'Tentang Kami', 'Keunggulan', 'FAQ'],
    requiredSignals: ['usia 2-6', 'makan siang', 'laporan harian'],
  },
  {
    id: 'gp-017-produk-herbal',
    persona: 'umkm-owner',
    industry: 'produk kesehatan',
    prompt: 'UMKM produk herbal madu dan jahe merah ingin website edukatif, tidak klaim medis berlebihan, dan ada katalog.',
    expectedSections: ['Hero', 'Katalog Produk', 'FAQ', 'Daftar Artikel'],
    requiredSignals: ['edukatif', 'tanpa klaim medis', 'katalog'],
  },
  {
    id: 'gp-018-travel-umroh',
    persona: 'umkm-owner',
    industry: 'travel',
    prompt: 'Agen travel umroh butuh halaman paket, jadwal keberangkatan, legalitas, dan konsultasi WhatsApp.',
    expectedSections: ['Hero', 'Layanan/Produk Grid', 'FAQ', 'CTA Banner'],
    requiredSignals: ['paket umroh', 'jadwal', 'legalitas', 'konsultasi'],
  },
  {
    id: 'gp-019-operator-revisi',
    persona: 'operator',
    industry: 'instruksi revisi',
    prompt: 'Klien minta revisi: ubah warna utama jadi hijau, tambah testimoni Bu Rina, dan pindahkan kontak ke atas footer.',
    expectedSections: ['Testimoni', 'Kontak+Peta', 'Footer'],
    requiredSignals: ['ubah warna', 'tambah testimoni', 'pindahkan kontak'],
  },
  {
    id: 'gp-020-needs-info',
    persona: 'operator',
    industry: 'brief kurang lengkap',
    prompt: 'Saya mau bikin website usaha, tapi belum tahu mau isinya apa. Tolong bantu tanya yang perlu.',
    expectedSections: ['Hero', 'FAQ'],
    requiredSignals: ['NEEDS_INFO', 'pertanyaan lanjutan', 'jangan menebak'],
  },
]);

export function getLlmGoldenPrompt(id: string): LlmGoldenPrompt | undefined {
  return LLM_GOLDEN_PROMPTS.find((prompt) => prompt.id === id);
}
