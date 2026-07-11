-- T-030tg: kanal Telegram (rencana B; WABA diparkir menunggu verifikasi Meta).

-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'TELEGRAM';

-- AlterTable: id chat di sisi penyedia kanal (Telegram chat_id). NULL untuk WEB.
ALTER TABLE "Conversation" ADD COLUMN "externalId" TEXT;

-- CreateIndex: satu percakapan per (tenant, kanal, chat) → pesan susulan dari chat yang
-- sama mendarat di Conversation yang sama, bukan bikin baru. NULL (WEB) tidak bertabrakan
-- karena Postgres memperlakukan NULL sebagai berbeda dalam unique index.
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalId_key" ON "Conversation"("tenantId", "channel", "externalId");
