Functional Requirement Document (FRD)
Platform Website Builder Berbasis Chatbot & Agentic AI — digimaestro.id


| Field | Keterangan |
| --- | --- |
| Versi Dokumen | 1.2 (Rebrand ke digimaestro.id; fokus tunggal produk) |
| Tanggal | 2 Juli 2026 |
| Pemilik Dokumen | Darusman (Product Owner) |
| Audiens | Tim pengembang & QA |
| Dokumen Terkait | BRD v1.0, PRD v1.0, SRS v1.0 |



# Daftar Isi

# 1. Pendahuluan
Dokumen ini merinci kebutuhan fungsional per modul sistem sebagai turunan dari fitur di PRD. Setiap kebutuhan diberi ID unik (format FR-<MODUL>-<NOMOR>) agar dapat dilacak ke test case. Prioritas: W = Wajib (MVP), S = Sebaiknya, O = Opsional.

# 2. Peta Modul Sistem


| Kode | Modul | Tanggung Jawab Utama |
| --- | --- | --- |
| CHN | Channel Gateway | Integrasi WhatsApp Cloud API & web chat; normalisasi pesan masuk/keluar. |
| CNV | Conversation Orchestrator | State percakapan, routing intent, sesi wawancara, konfirmasi aksi. |
| AGT | AI Agent Engine | Perencanaan & eksekusi tugas agent (build, edit, konten) via LLM tools. |
| CMP | Component Library & Site Model | Definisi section/komponen, tema & design token, skema halaman. |
| MED | Media Pipeline | Ingest media WA/web, kompresi, penyimpanan, image-gen & stock. |
| PUB | Preview, Approval & Publishing | Staging, versi, persetujuan, publish subdomain & custom domain. |
| CNT | Content/Blog Engine | Artikel blog, item katalog, penjadwalan konten. |
| BIL | Billing & Quota | Langganan Xendit, kuota job AI, suspensi. |
| ADM | Admin Dashboard | Monitoring tenant, inbox eskalasi, kontrol operasional. |
| NTF | Notification | Notifikasi WA/email ke klien & operator (diimplementasi via workflow n8n). |
| ANL | Analytics & Leads | Pelacakan pengunjung (Umami), laporan bulanan, form kontak & lead forwarding. |
| SEO | SEO Engine | Optimasi on-page otomatis, structured data, indexing, Search Console, riset kata kunci. |



# 3. Kebutuhan Fungsional per Modul

## 3.1 CHN — Channel Gateway


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-CHN-001 | Sistem menerima pesan masuk WhatsApp (teks, gambar, video, audio, dokumen, lokasi, balasan tombol) melalui webhook WhatsApp Cloud API dan menormalkannya ke format pesan internal tunggal. | W |
| FR-CHN-002 | Sistem mengirim pesan keluar WA: teks, media, interactive buttons/list, dan template message (untuk pesan di luar jendela 24 jam). | W |
| FR-CHN-003 | Sistem menyediakan widget web chat pada portal klien dengan kemampuan setara (teks, unggah media, tombol pilihan) dan riwayat tersinkron dengan kanal WA pada tenant yang sama. | W |
| FR-CHN-004 | Sistem mengaitkan nomor WA klien ke tenant; satu tenant dapat memiliki lebih dari satu nomor terotorisasi (pemilik + admin). | W |
| FR-CHN-005 | Sistem memvalidasi tanda tangan webhook Meta, melakukan dedup pesan (message id), dan menjamin idempotensi pemrosesan. | W |
| FR-CHN-006 | Sistem menerapkan rate limiting pesan keluar per tenant sesuai kebijakan WhatsApp. | W |
| FR-CHN-007 | Sistem mencatat status terkirim/terbaca pesan keluar (delivery receipts). | S |



## 3.2 CNV — Conversation Orchestrator


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-CNV-001 | Sistem mengelola state percakapan per tenant (mis. ONBOARDING, INTERVIEW, BUILDING, REVIEW, IDLE, SUPPORT) dan menyimpan konteks antar sesi. | W |
| FR-CNV-002 | Sistem mengklasifikasi intent tiap pesan (mis. jawab wawancara, minta revisi, minta konten, tanya status, tanya tagihan, minta manusia) dan merutekannya ke handler yang tepat. | W |
| FR-CNV-003 | Wawancara kebutuhan berjalan sebagai slot-filling: sistem melacak field brief yang wajib (identitas usaha, halaman, gaya, kontak, aset) dan hanya menanyakan yang belum terisi. | W |
| FR-CNV-004 | Sebelum aksi berdampak (bayar, publish, ganti domain, hapus konten), sistem menampilkan ringkasan dan meminta konfirmasi eksplisit (tombol Ya/Tidak). | W |
| FR-CNV-005 | Sistem menjawab pertanyaan status (“sampai mana?”) berdasarkan state & antrean job aktual, bukan jawaban generik. | W |
| FR-CNV-006 | Sistem mendeteksi kebuntuan (3 kegagalan pemahaman berturut-turut) atau permintaan eksplisit “mau bicara dengan orang” dan membuat tiket eskalasi (lihat ADM). | W |
| FR-CNV-007 | Operator dapat mengambil alih percakapan (human takeover); selama takeover, balasan otomatis dijeda dan dilanjutkan kembali oleh operator. | W |
| FR-CNV-008 | Sistem menolak dengan sopan permintaan di luar lingkup (mis. konten ilegal/SARA) berdasarkan kebijakan konten platform. | W |



## 3.3 AGT — AI Agent Engine


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-AGT-001 | Agent mengubah brief wawancara menjadi rencana situs terstruktur (daftar halaman, urutan section per halaman, tema & palet) dalam format JSON tervalidasi skema. | W |
| FR-AGT-002 | Agent merakit halaman hanya dari komponen yang terdaftar di Component Library beserta properti yang diizinkan skema komponen; output di luar skema ditolak dan diulang otomatis (self-repair loop, maks. 3 percobaan). | W |
| FR-AGT-003 | Agent menulis copywriting Bahasa Indonesia untuk setiap section (judul, subjudul, isi, CTA) sesuai profil usaha dan nada yang dipilih klien. | W |
| FR-AGT-004 | Agent menerima instruksi revisi bahasa alami dan menghasilkan patch perubahan terstruktur (tambah/hapus/ubah section atau properti), bukan menulis ulang seluruh situs. | W |
| FR-AGT-005 | Setiap eksekusi agent tercatat sebagai AgentJob dengan status (QUEUED, RUNNING, NEEDS_INFO, DONE, FAILED), log langkah, token terpakai, dan estimasi biaya. | W |
| FR-AGT-006 | Jika informasi kurang, agent bertanya balik melalui chatbot (status NEEDS_INFO) alih-alih menebak hal penting (nama usaha, harga, kontak). | W |
| FR-AGT-007 | Agent memilih sumber gambar per slot: unggahan klien (prioritas), stock photo relevan, atau AI image generation — sesuai preferensi klien & kuota. | W |
| FR-AGT-008 | Semua pemanggilan LLM melewati abstraction layer provider-agnostic (lihat SRS); pergantian provider tidak mengubah perilaku fungsional. | W |
| FR-AGT-009 | Agent menghasilkan alt text otomatis untuk semua gambar. | S |
| FR-AGT-010 | Seluruh kemampuan agent (operasi Site Document, media, konten, status billing, data SEO) diekspos sebagai tools melalui MCP (Model Context Protocol), sehingga definisi tool tunggal dapat dipakai lintas model LLM dan dapat dihubungkan ke host MCP eksternal (mis. asisten internal operator) dengan kontrol akses per scope. | W |



## 3.4 CMP — Component Library & Site Model


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-CMP-001 | Sistem menyediakan minimal 12 tipe section MVP: Hero, Tentang Kami, Layanan/Produk Grid, Galeri, Testimoni, Keunggulan, CTA Banner, FAQ, Kontak+Peta, Katalog Produk, Daftar Artikel, Footer. | W |
| FR-CMP-002 | Setiap tipe section memiliki skema properti (JSON Schema) dan minimal 2 varian layout. | W |
| FR-CMP-003 | Sistem menyediakan minimal 3 tema dengan design token (warna, tipografi, radius, spacing); seluruh styling komponen mengacu token, bukan nilai lepas. | W |
| FR-CMP-004 | Model situs disimpan sebagai dokumen terstruktur: Website → Pages → Sections (tipe, varian, properti) — dapat dirender deterministik oleh renderer React. | W |
| FR-CMP-005 | Penambahan tipe section baru tidak memerlukan perubahan pada engine agent (open/closed: registrasi komponen + skema). | W |



## 3.5 MED — Media Pipeline


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-MED-001 | Media dari WA diunduh dari server Meta segera setelah webhook diterima (URL media Meta kedaluwarsa) dan disimpan ke object storage per tenant. | W |
| FR-MED-002 | Gambar dioptimasi otomatis: resize multi-ukuran, kompresi, konversi WebP/AVIF; video divalidasi ukuran/durasi maksimum paket. | W |
| FR-MED-003 | Sistem menyediakan galeri media per tenant yang dapat dirujuk agent dan klien (“pakai foto yang kemarin saya kirim”). | W |
| FR-MED-004 | Integrasi image generation: prompt turunan dari konteks section, hasil disimpan sebagai aset tenant dengan penanda “AI-generated”. | W |
| FR-MED-005 | Integrasi stock photo berlisensi komersial dengan pencarian kata kunci; lisensi/atribusi dicatat per aset. | W |
| FR-MED-006 | Media dipindai tipe & ukuran; tipe berbahaya ditolak; EXIF lokasi dihapus saat publish. | W |



## 3.6 PUB — Preview, Approval & Publishing


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-PUB-001 | Setiap perubahan agent menghasilkan versi draft baru (immutable revision) dengan URL preview unik ber-token, tidak terindeks mesin pencari. | W |
| FR-PUB-002 | Bot mengirim preview + ringkasan perubahan (diff naratif: “menambah section testimoni, mengubah warna utama menjadi hijau”) kepada klien. | W |
| FR-PUB-003 | Persetujuan klien (tombol/kata kunci terkonfirmasi) memicu publish revisi tersebut; penolakan mengembalikan ke siklus revisi. | W |
| FR-PUB-004 | Publikasi berjalan sebagai pipeline: build statis Astro dari Revision yang disetujui → optimasi aset (AVIF/WebP, srcset) → deploy ke shared hosting via DeployPort (rsync/SSH, fallback FTP) → verifikasi HTTP 200; total ≤ 5 menit p90. | W |
| FR-PUB-004b | Subdomain klien (<slug>.digimaestro.id) dibuat otomatis via cPanel API saat publish pertama; TLS via AutoSSL; kegagalan pembuatan/SSL memicu retry & alert operator. | W |
| FR-PUB-005 | Klien dapat meminta rollback ke versi tayang sebelumnya via chat; artefak build minimal 10 revisi terakhir disimpan di object storage sehingga rollback = redeploy tanpa build ulang. | W |
| FR-PUB-006 | Custom domain (premium): domain ditambahkan sebagai addon domain via cPanel API; sistem memberi instruksi DNS, memverifikasi record berkala, memastikan AutoSSL terbit, dan mengonfirmasi via bot; kegagalan verifikasi > 48 jam memicu pengingat. | W |
| FR-PUB-007 | Unpublish/suspend situs (mis. gagal bayar) men-deploy halaman status sopan menggantikan situs, bukan menghapus file; reaktivasi = redeploy artefak terakhir. | W |
| FR-PUB-008 | Sitemap.xml, robots.txt, meta tag, dan Open Graph dihasilkan otomatis saat build; URL preview diberi tag noindex. | W |
| FR-PUB-009 | Target deploy dikonfigurasi per tenant (DeploymentTarget); penambahan target baru (akun hosting kedua, Cloudflare Pages) tidak mengubah pipeline — cukup adapter DeployPort baru. | W |
| FR-PUB-010 | Setiap build menjalankan pemeriksaan kualitas otomatis (Lighthouse CI budget: Performance ≥ 90, aksesibilitas dasar); kegagalan budget mencatat peringatan dan memblokir publish bila kritis. | S |



## 3.7 CNT — Content/Blog Engine


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-CNT-001 | Klien dapat meminta artikel blog via chat (topik bebas atau saran AI); agent menghasilkan draft artikel (judul, slug, isi, gambar sampul, meta description). | W |
| FR-CNT-002 | Draft artikel melewati alur approval yang sama (preview → setuju → tayang). | W |
| FR-CNT-003 | Klien dapat menjadwalkan publikasi artikel (tanggal/jam) via chat. | S |
| FR-CNT-004 | Item katalog produk dapat ditambah/diubah via chat, termasuk dari foto+caption WA (nama, harga, deskripsi diekstrak & dikonfirmasi). | W |
| FR-CNT-005 | Sistem melacak konsumsi kuota konten (artikel & gambar AI) per tenant per bulan. | W |



## 3.8 BIL — Billing & Quota


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-BIL-001 | Sistem membuat tautan pembayaran/checkout Xendit untuk aktivasi & perpanjangan langganan (VA, e-wallet, QRIS, kartu). | W |
| FR-BIL-002 | Webhook Xendit memperbarui status Subscription & Invoice secara idempoten; pembayaran sukses mengaktifkan/memperpanjang layanan otomatis. | W |
| FR-BIL-003 | Dunning: pengingat H-3, H-0, H+3 via WA; gagal bayar > 7 hari → suspensi situs; > 30 hari → arsip (data disimpan 90 hari sebelum penghapusan sesuai kebijakan). | W |
| FR-BIL-004 | Sistem menegakkan kuota job AI per paket: saat kuota habis, bot menawarkan upgrade/top-up alih-alih menolak kaku. | W |
| FR-BIL-005 | Klien dapat menanyakan status langganan, tagihan, dan kuota via chat, serta mengganti paket (upgrade berlaku segera, downgrade pada siklus berikutnya). | W |
| FR-BIL-006 | Semua invoice tersimpan dan dapat dikirim ulang sebagai PDF/link via chat. | S |



## 3.9 ADM — Admin Dashboard (Internal)


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-ADM-001 | Operator melihat daftar tenant dengan status (trial/aktif/suspend), paket, situs, dan kesehatan billing. | W |
| FR-ADM-002 | Inbox eskalasi: percakapan berlabel “butuh manusia” dengan konteks lengkap; operator membalas langsung dari dashboard. | W |
| FR-ADM-003 | Monitor antrean AgentJob: status, durasi, kegagalan, retry manual, dan biaya token per job/tenant/hari. | W |
| FR-ADM-004 | Operator dapat membuka preview/situs tenant, memicu rebuild, dan melakukan suspend/unsuspend manual dengan alasan tercatat (audit log). | W |
| FR-ADM-005 | Manajemen library: menambah komponen/tema baru dan menandai deprecated. | S |
| FR-ADM-006 | Kontrol akses berbasis peran internal (owner, operator) dengan autentikasi kuat. | W |



## 3.10 NTF — Notification


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-NTF-001 | Notifikasi ke klien via WA (template): draft siap ditinjau, publish berhasil, tagihan, kuota hampir habis, domain aktif. | W |
| FR-NTF-002 | Notifikasi ke operator (email/WA internal): eskalasi baru, job gagal beruntun, webhook error, anomali biaya AI. | W |
| FR-NTF-003 | Workflow notifikasi terjadwal (dunning, pengingat kuota, laporan bulanan) diimplementasi di n8n yang dipicu oleh API/event platform; logika keputusan tetap di kode, n8n hanya eksekusi pengiriman & penjadwalan. | W |



## 3.11 ANL — Analytics & Leads


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-ANL-001 | Setiap situs klien memuat skrip pelacakan Umami (self-host) dengan website-id per tenant; tanpa cookie pihak ketiga, selaras UU PDP. | S |
| FR-ANL-002 | Laporan bulanan (pengunjung, halaman populer, sumber trafik) dikirim otomatis ke WA klien via workflow n8n. | S |
| FR-ANL-003 | Form kontak pada situs statis melakukan POST ke endpoint API pusat per tenant dengan proteksi anti-spam (honeypot + rate limit + verifikasi asal); submission valid diteruskan ke WA klien dan tercatat sebagai Lead. | W |
| FR-ANL-004 | Klien dapat menanyakan ringkasan performa situs via chat (“berapa pengunjung bulan ini?”) dan bot menjawab dari data Umami. | O |



## 3.12 SEO — SEO Engine


| ID | Kebutuhan Fungsional | Prioritas |
| --- | --- | --- |
| FR-SEO-001 | Setiap halaman memuat metadata lengkap otomatis: title & meta description hasil AI (unik per halaman), canonical, Open Graph + Twitter Card, dan favicon/manifest. | W |
| FR-SEO-002 | Structured data (JSON-LD) dihasilkan otomatis sesuai konteks: LocalBusiness/Organization (profil), Product (katalog), Article + BreadcrumbList (blog), FAQPage (section FAQ), dan divalidasi terhadap skema schema.org saat build. | W |
| FR-SEO-003 | Sitemap.xml & robots.txt dihasilkan tiap publish; sistem melakukan ping IndexNow dan (bila terhubung) notifikasi Google melalui Search Console API agar halaman baru cepat terindeks. | W |
| FR-SEO-004 | Integrasi Google Search Console per situs: verifikasi kepemilikan otomatis (DNS/file), penarikan data performa (klik, impresi, posisi kata kunci) untuk laporan. | S |
| FR-SEO-005 | Artikel blog dihasilkan dari brief SEO: agent menyusun target kata kunci utama & turunan (dari input klien + data Search Console), struktur heading, dan internal link ke halaman/artikel terkait secara otomatis. | W |
| FR-SEO-006 | Laporan SEO bulanan via WA (workflow n8n): tren klik/impresi, kata kunci naik/turun, dan saran topik artikel berikutnya dari agent. | S |
| FR-SEO-007 | Audit SEO on-page otomatis pada tiap build (judul duplikat, meta kosong, gambar tanpa alt, heading rusak, broken internal link); temuan kritis memblokir publish, temuan minor dilaporkan ke operator. | W |
| FR-SEO-008 | Klien dapat bertanya via chat (“kenapa situs saya belum muncul di Google?”) dan bot menjawab berdasarkan status indexing & data Search Console aktual, bukan jawaban generik. | S |



# 4. Use Case Utama (Rinci)

## 4.1 UC-01: Membangun Website Pertama


| Elemen | Deskripsi |
| --- | --- |
| Aktor | Klien (via WA/web chat), Chatbot, AI Agent |
| Prasyarat | Tenant terdaftar; langganan aktif atau mode trial preview |
| Trigger | Wawancara kebutuhan dinyatakan lengkap oleh CNV (semua slot wajib terisi) |
| Alur Utama | 1) CNV menyusun brief → 2) AGT membuat rencana situs (FR-AGT-001) → 3) AGT merakit halaman & copywriting (FR-AGT-002/003) → 4) MED menyiapkan gambar (FR-AGT-007) → 5) PUB membuat revisi draft & URL preview → 6) NTF mengirim preview ke klien → 7) Klien setuju → 8) PUB publish ke subdomain → 9) NTF konfirmasi + tautan situs |
| Alur Alternatif | A1: Informasi kurang → AGT NEEDS_INFO → bot bertanya, lanjut dari langkah 2. A2: Klien minta revisi → UC-02. A3: Job gagal 3x → eskalasi operator + permintaan maaf ke klien |
| Pascakondisi | Website berstatus PUBLISHED; revisi tercatat; kuota terpotong |



## 4.2 UC-02: Revisi Website via Percakapan


| Elemen | Deskripsi |
| --- | --- |
| Trigger | Pesan klien berintent revisi (mis. “ganti foto hero”, “tambah FAQ”) |
| Alur Utama | 1) CNV klasifikasi intent revisi → 2) AGT menghasilkan patch terstruktur (FR-AGT-004) terhadap revisi terakhir → 3) Validasi skema → 4) Revisi draft baru + preview → 5) Diff naratif dikirim → 6) Approve → publish |
| Aturan | Patch tidak boleh menyentuh bagian yang tidak diminta; perubahan tema global dikonfirmasi terpisah karena berdampak seluruh situs |
| Alternatif | Instruksi ambigu → bot menanyakan klarifikasi dengan opsi tombol (maks. 1 pertanyaan per giliran) |



## 4.3 UC-03: Pembuatan Artikel Blog
Trigger: intent konten. Alur: agent menyusun outline → draft artikel penuh + gambar sampul → preview → approve → tayang (atau terjadwal). Aturan: artikel memakai gaya bahasa profil tenant; kuota artikel bulan berjalan dicek sebelum job dimulai (FR-BIL-004).

## 4.4 UC-04: Langganan & Gagal Bayar
Alur normal: checkout Xendit → webhook sukses → aktif. Alur gagal bayar: pengingat dunning (FR-BIL-003) → suspensi situs dengan halaman status → pembayaran kembali mengaktifkan otomatis tanpa kehilangan data.

## 4.5 UC-05: Aktivasi Custom Domain
Klien menyebut domain → sistem memvalidasi kepemilikan format → bot mengirim instruksi DNS spesifik registrar populer → verifikasi berkala → TLS otomatis → konfirmasi. Kegagalan umum (record salah/propagasi) dijelaskan bot dengan bahasa awam.

# 5. Aturan Bisnis (Business Rules)


| ID | Aturan |
| --- | --- |
| BRU-01 | Satu tenant = satu website aktif (MVP). Website tambahan memerlukan tenant/langganan terpisah. |
| BRU-02 | Tidak ada publikasi tanpa approval eksplisit klien pada revisi spesifik yang dipreview. |
| BRU-03 | Slug subdomain unik global, 3–30 karakter, alfanumerik+dash, tidak boleh kata terlarang. |
| BRU-04 | Job AI hanya berjalan bila langganan aktif dan kuota tersedia; trial dibatasi 1 siklus build + 5 revisi. |
| BRU-05 | Pesan keluar WA di luar jendela 24 jam wajib memakai template tersertifikasi Meta. |
| BRU-06 | Konten yang melanggar kebijakan (ilegal, menyesatkan, SARA, dewasa) ditolak dan dicatat; pelanggaran berulang dapat menonaktifkan tenant. |
| BRU-07 | Data tenant yang berhenti disimpan 90 hari lalu dihapus permanen, kecuali diminta lebih cepat (hak hapus UU PDP). |
| BRU-08 | Downgrade paket tidak menghapus konten; konten melebihi batas paket menjadi read-only. |



# 6. State Machine Utama

## 6.1 Status Website
DRAFTING → PREVIEW_READY → (APPROVED → PUBLISHED) | (REJECTED → DRAFTING). Dari PUBLISHED: perubahan baru membuat cabang DRAFTING tanpa mengubah versi tayang; SUSPENDED (gagal bayar/pelanggaran) ↔ PUBLISHED; ARCHIVED setelah masa tenggang.

## 6.2 Status AgentJob
QUEUED → RUNNING → (DONE | NEEDS_INFO | FAILED). NEEDS_INFO kembali ke QUEUED setelah klien menjawab. FAILED di-retry otomatis maks. 2x sebelum eskalasi.

## 6.3 Status Subscription
TRIALING → ACTIVE → PAST_DUE → SUSPENDED → (ACTIVE kembali | CANCELED → ARCHIVED).

# 7. Matriks Keterlacakan (Ringkas)


| Kebutuhan Bisnis (BRD) | Fitur (PRD) | FR Utama (FRD) |
| --- | --- | --- |
| BR-01 Chat-only building | F-01, F-02, F-03 | FR-CHN-001..004, FR-CNV-001..003 |
| BR-02 Kualitas konsisten | F-04, F-05 | FR-AGT-001..003, FR-CMP-001..005 |
| BR-03 Approval-first | F-07 | FR-PUB-001..003, BRU-02 |
| BR-04 Editing via chat | F-06, F-10 | FR-AGT-004, FR-CNT-001..004 |
| BR-05 Billing otomatis | F-12 | FR-BIL-001..003 |
| BR-06 Custom domain | F-15 | FR-PUB-006 |
| BR-07 Monitoring internal | F-14 | FR-ADM-001..004 |
| BR-08 Kendali biaya AI | F-13 | FR-AGT-005, FR-BIL-004..005 |
| BR-12 Ganti vendor LLM | — | FR-AGT-008 (rinci di SRS) |


Kriteria penerimaan per FR diturunkan langsung dari kalimat kebutuhan (dapat diuji), dan wajib dibuat sebagai test case sebelum implementasi tiap modul dimulai.

