-- Konsol admin via chat (PO 2026-07-15): chat admin "bertindak sebagai" satu tenant.
CREATE TABLE "AdminActing" (
    "chatId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminActing_pkey" PRIMARY KEY ("chatId")
);

ALTER TABLE "AdminActing" ADD CONSTRAINT "AdminActing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
