Product Requirements Document (PRD)
Platform Website Builder Berbasis Chatbot & Agentic AI — digimaestro.id


| Field | Keterangan |
| --- | --- |
| Versi Dokumen | 1.2 (Rebrand ke digimaestro.id; fokus tunggal produk) |
| Tanggal | 2 Juli 2026 |
| Pemilik Dokumen | Darusman (Product Owner) |
| Audiens | Tim pengembang, desain, operasional |
| Dokumen Terkait | BRD v1.0 (mengapa), FRD v1.0 (fungsi rinci), SRS v1.0 (teknis) |



# Daftar Isi

# 1. Visi & Positioning Produk
Visi: “Setiap UMKM Indonesia bisa punya website profesional hanya dengan chatting.”
Positioning: Bukan website builder yang dipermudah, melainkan “tim web agency dalam bentuk chatbot” — klien cukup bercerita tentang bisnisnya, AI yang mengerjakan sisanya: struktur situs, desain, copywriting, gambar, artikel, hingga pembaruan rutin.
Diferensiasi utama: (1) antarmuka WhatsApp — nol kurva belajar; (2) agentic AI yang tidak hanya membuat tetapi juga merawat website (artikel & konten bulanan); (3) approval-first — klien selalu pegang kendali akhir.

# 2. Persona Pengguna

## 2.1 Persona Primer — “Bu Rina”, Pemilik UMKM
Usia 30–55, menjalankan usaha kuliner/jasa/toko; sangat aktif di WhatsApp, jarang membuka laptop.
Tujuan: terlihat kredibel saat calon pelanggan mencari di Google; punya “alamat resmi” online.
Frustrasi: jasa web mahal & lambat; builder DIY membingungkan; tidak sempat menulis konten.
Perilaku kunci: menjawab pertanyaan singkat via chat, mengirim foto produk lewat WA, mengambil keputusan cepat jika ditunjukkan preview.

## 2.2 Persona Sekunder — “Mas Adi”, Admin/Staf Klien
Ditugaskan pemilik untuk mengurus konten; butuh cara cepat minta artikel/update promo via chat.

## 2.3 Persona Internal — Operator Platform
Tim penyedia (termasuk Darusman) yang memantau tenant, menangani eskalasi, meninjau kualitas output AI, dan mengelola billing.

# 3. Alur Pengguna Utama (User Journeys)

## 3.1 Journey A — Onboarding & Pembuatan Website Pertama


| Langkah | Aktor | Deskripsi |
| --- | --- | --- |
| 1. Kontak awal | Klien | Klien mengirim pesan ke nomor WA platform atau membuka web chat dari landing page. |
| 2. Registrasi ringan | Chatbot | Bot mengumpulkan nama, nama usaha, email; membuat akun tenant otomatis. |
| 3. Pemilihan paket & bayar | Chatbot + Xendit | Bot menjelaskan paket, mengirim tautan pembayaran Xendit; langganan aktif setelah pembayaran terverifikasi (opsi: trial/preview dulu, bayar sebelum publish). |
| 4. Wawancara kebutuhan | Chatbot | Bot menggali: jenis usaha, target pelanggan, halaman yang diinginkan, gaya/warna, foto & logo (upload via WA), kontak & alamat, media sosial. |
| 5. Perakitan oleh AI agent | AI Agent | Agent memilih komponen dari library, menyusun struktur halaman, menulis copywriting, menyiapkan gambar (upload/AI/stock). |
| 6. Preview | Chatbot | Bot mengirim tautan preview (staging URL) + ringkasan halaman ke klien. |
| 7. Revisi percakapan | Klien + Agent | Klien memberi instruksi bebas (“warna lebih cerah”, “tambah bagian testimoni”); agent merevisi, preview diperbarui. |
| 8. Persetujuan & publish | Klien | Klien mengetik/menekan tombol setuju → website tayang di subdomain (atau lanjut setup custom domain). |



## 3.2 Journey B — Pembaruan Konten Rutin
Klien mengirim pesan: “buatkan artikel tentang tips memilih katering pernikahan” atau mengirim foto produk baru dengan caption “masukkan ke katalog, harga 50 ribu”. Agent menghasilkan draft konten, mengirim preview, klien menyetujui, konten tayang. Bot juga proaktif mengingatkan kuota konten bulanan yang belum terpakai.

## 3.3 Journey C — Aktivasi Custom Domain (Paket Premium)
Klien menyebut domain miliknya → bot memandu setting DNS (CNAME/A record) langkah demi langkah → sistem memverifikasi DNS & menerbitkan sertifikat TLS otomatis → bot mengonfirmasi domain aktif.

## 3.4 Journey D — Eskalasi ke Manusia
Jika klien frustrasi, meminta manusia, atau bot mendeteksi kebuntuan (3x gagal memahami), percakapan ditandai “butuh manusia” di dashboard operator; operator membalas dari dashboard melalui kanal yang sama.

# 4. Fitur & Prioritas (MoSCoW)

## 4.1 Must Have (MVP tidak rilis tanpa ini)


| ID | Fitur | Ringkasan |
| --- | --- | --- |
| F-01 | Chatbot WA (WABA resmi) | Terima/kirim pesan, media, tombol interaktif, template message. |
| F-02 | Web chat portal | Widget chat di portal klien dengan riwayat tersinkron per tenant. |
| F-03 | Wawancara kebutuhan terpandu | Alur tanya-jawab terstruktur + slot-filling oleh LLM (brief website). |
| F-04 | AI Agent perakit website | Merakit halaman dari library komponen + menulis copywriting. |
| F-05 | Library komponen & tema | Kumpulan section (hero, tentang, layanan, galeri, testimoni, kontak, katalog, blog) dengan varian gaya & token desain. |
| F-06 | Editing via percakapan | Instruksi bahasa alami → perubahan terstruktur pada halaman. |
| F-07 | Preview & approval flow | URL staging, diff ringkasan perubahan, persetujuan eksplisit sebelum publish. |
| F-08 | Pipeline publish | Build statis (Astro) → deploy otomatis ke shared hosting (subdomain, AutoSSL) ≤ 5 menit; preview tetap di VPS. |
| F-09 | Media pipeline | Terima foto/video via WA & web, kompresi, penyimpanan objek, galeri per tenant. |
| F-10 | Generator konten blog | Artikel SEO-friendly Bahasa Indonesia dari instruksi singkat + jadwal. |
| F-11 | AI image generation & stock | Gambar ilustrasi via provider image-gen + pencarian stock photo berlisensi. |
| F-12 | Billing Xendit | Checkout langganan, recurring, webhook status bayar, dunning, suspensi otomatis. |
| F-13 | Kuota & metering AI | Penghitungan job AI per tenant sesuai paket; blokir halus saat kuota habis. |
| F-14 | Dashboard operator | Daftar tenant & status, inbox eskalasi, monitor antrean job, kontrol billing. |
| F-15 | Custom domain (premium) | Verifikasi DNS + TLS otomatis, dipandu chatbot. |
| F-16 | SEO Engine “heavy” | Meta & structured data otomatis, sitemap + ping indexing, internal linking, integrasi Google Search Console, artikel berbasis riset kata kunci, laporan ranking via WA. |



## 4.2 Should Have (segera setelah MVP)
Analytics pengunjung via Umami self-host (di VPS, ramah UU PDP): laporan bulanan otomatis ke WA klien melalui workflow n8n.
Formulir kontak website statis → POST ke API pusat (anti-spam) → diteruskan ke WA klien (lead forwarding).
Pengingat proaktif: kuota konten belum terpakai, promo musiman (dijalankan via n8n).

## 4.3 Could Have
Multi-bahasa (ID/EN) untuk website klien.
Integrasi Google Business Profile.
Template industri (katering, bengkel, klinik, dll.) untuk mempercepat wawancara.

## 4.4 Won't Have (fase ini)
Checkout/pembayaran di website klien (e-commerce penuh); pembuatan video oleh AI; editor drag-and-drop untuk klien; aplikasi mobile native.

# 5. Rencana Rilis Bertahap
Dengan kapasitas 1–2 developer, scope penuh dipecah menjadi tiga fase internal. Semua fase tetap bagian dari “MVP komersial” namun dirilis bertahap ke klien terbatas.


| Fase | Durasi (estimasi) | Cakupan | Gerbang Keluar (Exit Criteria) |
| --- | --- | --- | --- |
| Fase 0 — Fondasi | 3–4 minggu | Setup monorepo (pnpm+Turborepo), CI, skema data inti, autentikasi tenant, integrasi WABA & webhook, LLM abstraction layer, web chat dasar, PoC pipeline deploy Astro → shared hosting (cPanel API + rsync/SSH), setup n8n & Umami. | Pesan WA & web chat masuk-keluar tercatat per tenant; satu situs contoh berhasil ter-deploy otomatis ke shared hosting dengan AutoSSL. |
| Fase 1 — Builder Inti | 6–8 minggu | F-03 s.d. F-09, F-12, F-13: wawancara, agent perakit, library komponen (min. 12 section, 3 tema), preview, approval, publish subdomain, billing & kuota. | 10 klien pilot menyelesaikan alur end-to-end; GO-04 (draft < 30 menit) tercapai. |
| Fase 2 — Konten & Premium | 4–6 minggu | F-10, F-11, F-15, F-14 lengkap: blog & konten AI, image-gen + stock, custom domain, dashboard operator penuh. | Klien premium pertama aktif dengan custom domain; laporan kuota akurat. |



# 6. Persyaratan Pengalaman Produk

## 6.1 Bahasa & Nada Chatbot
Bahasa Indonesia santai-profesional; pertanyaan satu per satu; selalu menawarkan contoh jawaban.
Setiap aksi penting (bayar, publish, ganti domain) dikonfirmasi eksplisit dan dirangkum sebelum eksekusi.
Bot selalu bisa menjawab “sampai mana progres saya?” dengan status akurat.

## 6.2 Kualitas Output Website
Semua website lolos standar Core Web Vitals Google: LCP ≤ 2,5 dtk, INP < 200 ms, CLS < 0,1 (data lapangan), skor Lighthouse Performance ≥ 90, responsif mobile, aksesibilitas dasar (kontras, alt text otomatis).
Situs klien dibangun zero-JS-by-default (Astro): JavaScript hanya dimuat untuk komponen interaktif tertentu, gambar AVIF/WebP responsif dengan lazy loading.
Konsistensi visual dijamin design token per tema; AI tidak boleh keluar dari token (dijaga oleh skema validasi, lihat SRS).

## 6.3 Kepercayaan & Kendali
Approval-first: tidak ada perubahan tayang tanpa persetujuan; tersedia riwayat versi dan “kembalikan ke versi sebelumnya” via chat.
Transparansi kuota: bot menyebut sisa kuota saat klien meminta job AI.

# 7. Metrik Produk


| Kategori | Metrik | Target Awal |
| --- | --- | --- |
| Aktivasi | % klien yang publish ≤ 7 hari sejak registrasi | ≥ 60% |
| Aktivasi | Waktu median wawancara selesai → draft pertama | < 30 menit |
| Engagement | % tenant dengan ≥ 1 update konten / bulan | ≥ 50% |
| Kualitas AI | Rata-rata revisi sebelum approve pertama | ≤ 3 putaran |
| Retensi | Churn bulanan berbayar | < 5% |
| Ekonomi | Biaya AI (LLM+gambar+WABA) per tenant / ARPU | < 15% |
| Dukungan | % percakapan yang butuh eskalasi manusia | < 10% |



# 8. Asumsi & Pertanyaan Terbuka
Harga final paket dan besaran kuota job AI — ditetapkan sebelum Fase 1 selesai (dipengaruhi biaya aktual DeepSeek & image-gen).
Kebijakan trial: preview gratis lalu bayar-sebelum-publish vs bayar di depan — direkomendasikan preview gratis untuk menaikkan konversi; keputusan final di tangan sponsor.
Pemilihan provider image generation & stock photo (lisensi komersial) — dievaluasi di Fase 0.
Nama produk & domain platform final.

