-- Self-serve onboarding + kuota trial (keputusan PO 2026-07-12).
-- Menggantikan allowlist env (harus disunting manual tiap pelanggan → mustahil self-serve)
-- dengan pemetaan di DB, dan memasang PAGAR BIAYA: tiap pesan memanggil LLM berbayar.

-- CreateTable: kode undangan. Self-serve TAPI tidak terbuka untuk siapa saja — tanpa gerbang
-- ini, orang iseng yang menemukan bot langsung membakar token (~$0.0034/pesan).
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateTable: chat kanal → tenant.
CREATE TABLE "ChannelBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelBinding_pkey" PRIMARY KEY ("id")
);

-- Satu chat = satu tenant (chat sama tak bisa dipetakan ke dua tenant).
CREATE UNIQUE INDEX "ChannelBinding_channel_externalId_key" ON "ChannelBinding"("channel", "externalId");
CREATE INDEX "ChannelBinding_tenantId_idx" ON "ChannelBinding"("tenantId");

ALTER TABLE "ChannelBinding" ADD CONSTRAINT "ChannelBinding_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: kuota trial (PO: 100 pesan · 1 situs · 14 hari).
ALTER TABLE "Tenant" ADD COLUMN "quotaMessages" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Tenant" ADD COLUMN "usedMessages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN "quotaWebsites" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "inviteCodeId" TEXT;

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_inviteCodeId_fkey"
  FOREIGN KEY ("inviteCodeId") REFERENCES "InviteCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant yang SUDAH ADA (dibuat manual sebelum self-serve) diberi kuota longgar & tanpa
-- batas waktu: mereka tak boleh tiba-tiba kehabisan kuota karena fitur baru ini.
UPDATE "Tenant" SET "quotaMessages" = 100000, "trialEndsAt" = NULL;
