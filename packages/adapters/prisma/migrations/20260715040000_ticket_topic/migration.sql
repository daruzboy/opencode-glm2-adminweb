-- Tiket per topik + prioritas (dashboard admin).
ALTER TABLE "Ticket" ADD COLUMN "topic" TEXT,
                     ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
