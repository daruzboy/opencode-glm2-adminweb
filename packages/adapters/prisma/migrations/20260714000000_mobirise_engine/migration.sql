-- P2: fondasi engine Mobirise (dual-mode renderer) + registry template + gerbang review PO
-- + atribusi gambar stok. SEMUA aditif — nol migrasi data; situs sections-v1 yang ada
-- tak tersentuh (default 'sections-v1' membuat revisi lama tetap dikenali renderer lama).

-- Diskriminator per-REVISI (bukan per-Website): situs lama ter-render selamanya; tenant
-- "bermigrasi" cukup dengan mendapat revisi mobirise baru.
ALTER TABLE "Revision" ADD COLUMN "renderEngine" TEXT NOT NULL DEFAULT 'sections-v1';
ALTER TABLE "Revision" ADD COLUMN "templateId" TEXT;
ALTER TABLE "Revision" ADD COLUMN "editorProjectId" TEXT;

-- Aturan gerbang review O(1): revisi.templateId != approvedTemplateId → wajib review PO.
ALTER TABLE "Website" ADD COLUMN "approvedTemplateId" TEXT;

-- Gerbang review PO (keputusan PO 2026-07-14): template BARU → review admin dulu;
-- perubahan isi pada template sama → langsung ke pelanggan.
ALTER TYPE "RevisionStatus" ADD VALUE 'PENDING_ADMIN_REVIEW';

-- Atribusi gambar stok (syarat lisensi Unsplash/Pexels; foto di-rehost, bukan hotlink).
ALTER TABLE "MediaAsset" ADD COLUMN "sourceProvider" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "authorName" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "authorUrl" TEXT;

-- Registry template: baris = folder di TEMPLATES_DIR; folder-lah sumber kebenaran
-- (di-gitignore karena lisensi), indexer yang menyinkronkan. Tanpa tenantId: katalog
-- platform, bukan data pelanggan.
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "businessTypes" TEXT[],
    "tags" TEXT[],
    "slotSummary" JSONB NOT NULL,
    "coverPath" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceHash" TEXT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);
