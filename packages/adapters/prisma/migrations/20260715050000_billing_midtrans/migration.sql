-- E1 billing Midtrans: masa layanan berbayar + tabel invoice.
ALTER TABLE "Tenant" ADD COLUMN "serviceEndsAt" TIMESTAMP(3);

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'midtrans',
    "orderId" TEXT NOT NULL,
    "amountIdr" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "paymentUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
