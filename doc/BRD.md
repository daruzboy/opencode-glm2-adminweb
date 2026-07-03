Business Requirement Document (BRD)
Platform Website Builder Berbasis Chatbot & Agentic AI
Produk: digimaestro.id


| Field | Keterangan |
| --- | --- |
| Versi Dokumen | 1.2 (Rebrand ke digimaestro.id; fokus tunggal produk) |
| Tanggal | 2 Juli 2026 |
| Pemilik Dokumen | Darusman (Product Owner / Sponsor) |
| Audiens | Sponsor, tim pengembang, calon mitra |
| Status | Menunggu persetujuan |
| Dokumen Terkait | PRD v1.0, FRD v1.0, SRS v1.0 |



# Daftar Isi

# 1. Ringkasan Eksekutif
Dokumen ini mendefinisikan kebutuhan bisnis untuk pembangunan platform SaaS pembuat website berbasis chatbot dan agentic AI. Klien (terutama UMKM) dapat membuat, mengedit, dan mengisi konten website — company profile, landing page, katalog produk, dan blog — sepenuhnya melalui percakapan di WhatsApp atau web chat, tanpa keahlian teknis. AI agent menerjemahkan percakapan menjadi website yang siap tayang, dengan mekanisme persetujuan klien sebelum publikasi.
Model bisnis adalah langganan bulanan (SaaS subscription) dengan dua tingkat paket: paket dasar dengan subdomain platform, dan paket premium dengan custom domain. Target 12 bulan pertama adalah 100–500 klien aktif berbayar.

# 2. Latar Belakang & Permasalahan Bisnis

## 2.1 Permasalahan yang Diselesaikan
Mayoritas UMKM Indonesia belum memiliki website karena hambatan biaya jasa pembuatan (Rp2–10 juta sekali bayar), hambatan teknis, dan proses yang lambat (berminggu-minggu).
Website builder konvensional (drag-and-drop) tetap terasa sulit bagi pemilik usaha yang tidak terbiasa dengan komputer; mereka jauh lebih nyaman berkomunikasi lewat WhatsApp.
Setelah website jadi, pemeliharaan konten (artikel, foto produk, promo) sering terbengkalai karena tidak ada cara mudah untuk memperbaruinya.

## 2.2 Peluang
WhatsApp adalah kanal komunikasi dominan pelaku UMKM Indonesia — menjadikannya antarmuka pembuatan website paling rendah friksi.
Kemajuan LLM dan agentic AI memungkinkan otomasi penuh dari wawancara kebutuhan hingga perakitan website, menekan biaya produksi per klien mendekati nol marginal.
Model langganan menciptakan pendapatan berulang (recurring revenue) yang lebih sehat dibanding model proyek sekali bayar.

## 2.3 Keselarasan Strategis
Platform ini melengkapi lini bisnis penyedia (jasa administrasi pajak dan digital marketing untuk UMKM). Basis klien yang sama dapat di-cross-sell, dan chatbot yang sama berpotensi menjadi kanal layanan tambahan di masa depan.

# 3. Tujuan & Sasaran Bisnis


| ID | Tujuan Bisnis | Ukuran Keberhasilan (12 bulan) |
| --- | --- | --- |
| GO-01 | Membangun basis pelanggan berlangganan | 100–500 klien aktif berbayar |
| GO-02 | Pendapatan berulang yang sehat | MRR tumbuh konsisten; churn bulanan < 5% |
| GO-03 | Otomasi produksi website | ≥ 80% website tayang tanpa intervensi manual tim |
| GO-04 | Kecepatan layanan | Draft website pertama < 30 menit sejak wawancara chatbot selesai |
| GO-05 | Efisiensi biaya AI | Biaya LLM + media per klien < 15% dari harga langganan |
| GO-06 | Kepuasan pelanggan | CSAT ≥ 4,2/5; ≥ 50% klien aktif memperbarui konten tiap bulan |



# 4. Ruang Lingkup

## 4.1 Termasuk dalam Lingkup (In Scope)
Chatbot omnichannel: WhatsApp (WhatsApp Business API resmi/Meta Cloud API) dan web chat pada portal platform.
AI agent yang mewawancarai klien, merakit website dari library komponen, dan mengedit website berdasarkan instruksi percakapan.
Jenis website: company profile, landing page, katalog produk (tanpa checkout/pembayaran), dan blog.
Pembuatan konten oleh AI: teks artikel, copywriting halaman, gambar (AI image generation), serta dukungan unggah foto/video klien via WA dan pemilihan stock photo.
Alur persetujuan: AI menghasilkan draft → klien meninjau preview → klien menyetujui → publikasi.
Hosting terkelola: subdomain platform (default) dan custom domain (paket premium).
SEO menyeluruh (“heavy”) sebagai nilai jual inti: structured data, optimasi on-page otomatis oleh AI, sitemap & ping indexing, integrasi Google Search Console, dan laporan performa pencarian ke klien.
Billing langganan bulanan via Xendit (recurring), termasuk penagihan, dunning, dan suspensi otomatis.
Dashboard admin internal untuk monitoring tenant, percakapan, antrean pekerjaan AI, dan billing.

## 4.2 Di Luar Lingkup (Out of Scope) — Fase Ini
E-commerce penuh (keranjang, checkout, pembayaran di website klien).
Aplikasi mobile native untuk klien.
Pembuatan video oleh AI (video hanya didukung sebagai unggahan klien / embed).
Multi-bahasa website klien selain Bahasa Indonesia dan Inggris.
Migrasi otomatis website lama klien dari platform lain.
Marketplace template pihak ketiga.

# 5. Pemangku Kepentingan (Stakeholders)


| Pemangku Kepentingan | Peran | Kepentingan Utama |
| --- | --- | --- |
| Sponsor / Pemilik (Darusman) | Keputusan bisnis, prioritas, anggaran | ROI, kecepatan ke pasar, kualitas layanan |
| Tim Pengembang (1–2 dev) | Membangun & mengoperasikan platform | Spesifikasi jelas, lingkup realistis, arsitektur terkelola |
| Klien UMKM | Pengguna akhir (pemesan website) | Mudah, cepat, murah, hasil profesional |
| Tim Operasional/CS | Eskalasi percakapan & dukungan | Alat monitoring, alur eskalasi dari chatbot |
| Meta (WhatsApp) | Penyedia kanal WABA | Kepatuhan kebijakan WhatsApp Business |
| Xendit | Penyedia payment gateway | Integrasi teknis & kepatuhan |
| Regulator (UU PDP) | Perlindungan data pribadi | Kepatuhan pemrosesan data klien & pengunjung |



# 6. Model Bisnis & Paket Layanan

## 6.1 Model Pendapatan
Langganan bulanan prabayar melalui Xendit dengan pilihan pembayaran populer (VA bank, e-wallet, QRIS, kartu). Diskon untuk pembayaran tahunan dipertimbangkan setelah MVP.

## 6.2 Struktur Paket (Indikatif — finalisasi harga di luar dokumen ini)


| Aspek | Paket Dasar | Paket Premium |
| --- | --- | --- |
| Domain | Subdomain: namausaha.digimaestro.id | Custom domain milik klien |
| Jenis halaman | Company profile + landing page | Semua (termasuk katalog & blog) |
| Kuota konten AI / bulan | Misal: 4 artikel + 10 gambar AI | Misal: 12 artikel + 30 gambar AI |
| Revisi via chatbot | Wajar (fair use, dibatasi kuota job AI) | Kuota lebih besar + prioritas antrean |
| Dukungan | Chatbot + eskalasi email | Chatbot + eskalasi manusia prioritas |


Catatan: kuota job AI per paket adalah pengendali utama biaya LLM/media dan wajib ditegakkan secara sistem (lihat FRD modul Billing & Kuota).

# 7. Kebutuhan Bisnis (Business Requirements)


| ID | Kebutuhan Bisnis | Prioritas |
| --- | --- | --- |
| BR-01 | Klien dapat memesan dan membangun website sepenuhnya melalui percakapan WA atau web chat, tanpa menyentuh editor visual. | Wajib |
| BR-02 | Website hasil AI harus konsisten profesional: dirakit dari library komponen terkurasi, bukan kode bebas. | Wajib |
| BR-03 | Tidak ada konten yang tayang tanpa persetujuan eksplisit klien (approval-first). | Wajib |
| BR-04 | Klien dapat meminta perubahan website & konten kapan pun via chatbot, dan perubahan tayang setelah disetujui. | Wajib |
| BR-05 | Sistem menagih langganan otomatis via Xendit, termasuk pengingat, percobaan ulang, dan suspensi saat gagal bayar. | Wajib |
| BR-06 | Paket premium mendukung custom domain dengan aktivasi semi-otomatis (panduan DNS via chatbot). | Wajib |
| BR-07 | Tim internal dapat memantau seluruh tenant, percakapan, dan pekerjaan AI dari satu dashboard. | Wajib |
| BR-08 | Biaya AI per tenant terukur dan dibatasi kuota paket. | Wajib |
| BR-09 | Percakapan sensitif atau kebuntuan chatbot dapat dieskalasi ke manusia. | Sebaiknya |
| BR-10 | Platform mematuhi UU PDP: persetujuan pemrosesan data, hak hapus data, dan penyimpanan data di wilayah yang sesuai. | Wajib |
| BR-11 | Platform siap melayani 500 tenant aktif tanpa perombakan arsitektur. | Wajib |
| BR-12 | Vendor LLM dapat diganti tanpa mengubah logika bisnis (abstraction layer). | Sebaiknya |



# 8. Asumsi, Ketergantungan & Batasan

## 8.1 Asumsi
Klien memiliki WhatsApp aktif dan bersedia berinteraksi dengan bot.
Konten dasar bisnis (nama, deskripsi, foto) dapat disediakan klien atau dihasilkan AI dengan validasi klien.
DeepSeek (atau LLM setara) tersedia dengan biaya per token yang menjaga target margin GO-05.

## 8.2 Ketergantungan
Persetujuan WhatsApp Business API (verifikasi bisnis Meta) — jalur kritis, urus paling awal.
Akun Xendit terverifikasi dengan fitur recurring aktif.
Penyedia image generation terpisah (DeepSeek tidak menyediakan image generation).
Akses SSH/FTP dan cPanel API pada akun shared hosting milik penyedia (untuk deploy otomatis situs klien, pembuatan subdomain/addon domain, dan AutoSSL).
VPS di data center Indonesia (mis. IDCloudHost/Biznet) untuk platform inti — sekaligus mendukung kepatuhan residensi data UU PDP.

## 8.3 Batasan (Constraints)
Kapasitas tim 1–2 developer → lingkup MVP harus difase-kan ketat (lihat PRD bab Rilis).
Biaya percakapan WABA (per conversation window Meta) harus diperhitungkan dalam harga paket.
Stack ditetapkan: Node.js (TypeScript), Prisma, PostgreSQL, React untuk platform; Astro untuk situs klien — dengan prinsip clean architecture, SOLID, dan panduan web modern Google (web.dev / Core Web Vitals).
Website klien di-hosting terpisah pada shared hosting cPanel yang sudah dimiliki (satu akun, addon/subdomain per klien), berupa situs statis penuh; fitur dinamis (form, analytics) dilayani API pusat di VPS.
Chatbot & platform berjalan di VPS; otomasi operasional sekunder memakai n8n (model hybrid: logika inti tetap di kode).

# 9. Risiko Bisnis & Mitigasi


| ID | Risiko | Dampak | Mitigasi |
| --- | --- | --- | --- |
| RSK-01 | Verifikasi WABA lambat/ditolak | Tinggi | Ajukan sejak minggu pertama; siapkan web chat sebagai kanal cadangan penuh |
| RSK-02 | Biaya LLM/gambar membengkak | Tinggi | Kuota per paket, caching prompt, model routing (tugas ringan ke model murah), monitoring biaya per tenant |
| RSK-03 | Kualitas output AI mengecewakan klien | Tinggi | Library komponen terkurasi, guardrail prompt, alur approval, tombol eskalasi ke manusia |
| RSK-04 | Kapasitas 1–2 dev tidak cukup | Tinggi | Fase rilis ketat, arsitektur modular monolith (bukan microservices), pakai layanan terkelola |
| RSK-05 | Churn tinggi setelah website jadi | Sedang | Nilai berkelanjutan: kuota artikel bulanan, laporan pengunjung, pengingat konten via WA |
| RSK-06 | Pelanggaran kebijakan WhatsApp (spam) | Sedang | Hanya pesan dalam sesi/opt-in, template message tersertifikasi, rate limiting |
| RSK-07 | Kebocoran data pribadi (UU PDP) | Tinggi | Enkripsi at-rest & in-transit, kontrol akses, kebijakan privasi, mekanisme hak subjek data |
| RSK-08 | Ketergantungan satu vendor LLM | Sedang | LLM abstraction layer; uji minimal 2 provider sejak awal |
| RSK-09 | Satu akun shared hosting = single point of failure (suspend/limit inode mematikan semua situs klien) | Tinggi | Deploy dibungkus DeployPort (mudah pindah target); pantau inode/resource; siapkan akun kedua/reseller WHM saat > ±150 situs; backup artefak build di object storage sehingga redeploy ke target lain < 1 jam |
| RSK-10 | Perubahan kebijakan/harga penyedia shared hosting | Sedang | Kontrak/paket didokumentasi; alternatif target deploy (Cloudflare Pages) sudah teruji sebagai adapter cadangan |



# 10. Analisis Manfaat–Biaya (Ringkas)
Biaya utama: pengembangan (1–2 dev), infrastruktur (VPS, storage, CDN), biaya per-percakapan WABA, biaya token LLM & image generation, biaya Xendit per transaksi.
Manfaat: pendapatan berulang bulanan, biaya produksi marginal rendah per klien tambahan, aset teknologi (chatbot + agent) yang dapat digunakan lini bisnis lain.
Titik impas: dihitung terpisah setelah harga paket final; indikator kunci adalah GO-05 (biaya AI < 15% harga langganan) dan churn < 5%.

# 11. Kriteria Keberhasilan & Persetujuan
Proyek dinyatakan berhasil pada fase MVP apabila: (1) klien dapat menyelesaikan alur end-to-end (wawancara → draft → approve → publish) tanpa bantuan manual; (2) minimal 10 klien berbayar aktif dalam 60 hari pertama peluncuran; (3) seluruh kebutuhan bisnis berprioritas “Wajib” terpenuhi.


| Peran | Nama | Tanda Tangan / Tanggal |
| --- | --- | --- |
| Sponsor / Product Owner | Darusman |  |
| Lead Developer |  |  |



