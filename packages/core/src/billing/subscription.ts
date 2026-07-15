// E1 Billing langganan (Midtrans, PO 2026-07-15): tagihan otomatis setelah situs LIVE.
//
// - createSubscriptionInvoice: dipanggil worker publish setelah publish live sukses.
//   Invoice PENDING yang ada dipakai ulang (publish/revisi berulang ≠ tagihan berulang);
//   layanan yang masih berjalan (serviceEndsAt di masa depan) tidak ditagih lagi.
// - pollPendingInvoices: dipanggil berkala (webhook mustahil — VPS tanpa domain publik).
//   settlement → invoice PAID + tenant ACTIVE + serviceEndsAt bertambah + notifikasi chat.
//
// Murni Port: tak kenal Midtrans/Prisma/Telegram.

import { err, ok } from '@digimaestro/shared';
import type {
  BillingTenantPort,
  InvoiceRepository,
  PaymentGatewayPort,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface SubscriptionConfig {
  // Harga langganan per periode, rupiah utuh (mis. 150000).
  readonly priceIdr: number;
  readonly periodDays: number;
}

export interface CreateInvoiceDeps {
  readonly gateway: PaymentGatewayPort;
  readonly invoices: InvoiceRepository;
  readonly tenants: BillingTenantPort;
  readonly config: SubscriptionConfig;
  readonly now?: () => Date;
}

export type CreateInvoiceOutcome =
  | { readonly kind: 'created' | 'reused'; readonly paymentUrl: string; readonly amountIdr: number }
  // Layanan masih aktif — tidak ada tagihan baru (publish revisi, bukan langganan baru).
  | { readonly kind: 'skipped'; readonly reason: string };

const rupiah = (n: number): string => `Rp${n.toLocaleString('id-ID')}`;

// normalPriceIdr (opsional): harga sebelum diskon — bila lebih mahal dari amountIdr,
// pesan menampilkan harga promo (harga normal dicoret ala promosi).
export function paymentRequestMessage(
  paymentUrl: string,
  amountIdr: number,
  periodDays: number,
  normalPriceIdr?: number,
): string {
  const harga =
    normalPriceIdr && normalPriceIdr > amountIdr
      ? `harga promo ${rupiah(amountIdr)} (normal ${rupiah(normalPriceIdr)})`
      : rupiah(amountIdr);
  return (
    `Satu langkah lagi 🧾 Untuk mengaktifkan layanan ${periodDays} hari ke depan, ` +
    `mohon selesaikan pembayaran ${harga} melalui tautan berikut:\n${paymentUrl}\n\n` +
    'Tautan berlaku 24 jam. Bila melewati batas itu, situs akan kami tahan sementara ' +
    'sampai pembayaran diterima. Setelah lunas, layanan langsung aktif dan kami kabari di sini.'
  );
}

// Kebijakan PO: tak ada jatuh tempo — bayar <24 jam setelah publish, selebihnya DITAHAN.
export function paymentExpiredMessage(): string {
  return (
    'Waktu pembayaran telah berakhir, dan situs Anda kami tahan sementara. ' +
    'Tidak ada data yang hilang — balas pesan ini bila ingin melanjutkan, tim kami siap membantu mengaktifkannya kembali.'
  );
}

export function paymentPaidMessage(endsAt: Date): string {
  const tgl = endsAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    `Pembayaran diterima — terima kasih! 🎉\n\n` +
    `Layananmu sekarang AKTIF sampai ${tgl}. Kalau ada yang mau diubah di situsmu, tulis aja di sini.`
  );
}

// order_id Midtrans: unik, alfanumerik+dash, maks 50 karakter.
export function subscriptionOrderId(tenantId: TenantId, now: Date): string {
  return `dm-${String(tenantId).slice(-8)}-${now.getTime()}`;
}

export async function createSubscriptionInvoice(
  deps: CreateInvoiceDeps,
  req: { readonly tenantId: TenantId; readonly customerName?: string },
): Promise<Result<CreateInvoiceOutcome, Error>> {
  const now = deps.now?.() ?? new Date();

  // Invoice PENDING yang ada dipakai ulang — link yang sama dikirim lagi.
  const open = await deps.invoices.findOpenByTenant(req.tenantId);
  if (!open.ok) return err(new Error(open.error.message));
  if (open.value) {
    return ok({ kind: 'reused', paymentUrl: open.value.paymentUrl, amountIdr: open.value.amountIdr });
  }

  const svc = await deps.tenants.getService(req.tenantId);
  if (!svc.ok) return err(new Error(svc.error.message));
  if (svc.value.serviceEndsAt && new Date(svc.value.serviceEndsAt).getTime() > now.getTime()) {
    return ok({ kind: 'skipped', reason: `layanan masih aktif s.d. ${svc.value.serviceEndsAt}` });
  }

  const orderId = subscriptionOrderId(req.tenantId, now);
  const link = await deps.gateway.createPaymentLink({
    orderId,
    amountIdr: deps.config.priceIdr,
    ...(req.customerName ? { customerName: req.customerName } : {}),
    description: `Langganan Simple-Web ${deps.config.periodDays} hari`,
  });
  if (!link.ok) return err(new Error(link.error.message));

  const created = await deps.invoices.create(req.tenantId, {
    provider: deps.gateway.provider,
    orderId,
    amountIdr: deps.config.priceIdr,
    periodDays: deps.config.periodDays,
    paymentUrl: link.value.paymentUrl,
  });
  if (!created.ok) return err(new Error(created.error.message));

  return ok({ kind: 'created', paymentUrl: link.value.paymentUrl, amountIdr: deps.config.priceIdr });
}

export interface PollDeps {
  readonly gateway: PaymentGatewayPort;
  readonly invoices: InvoiceRepository;
  readonly tenants: BillingTenantPort;
  // Kirim teks ke chat tenant (worker menyuntik notifyTenantText). Best-effort.
  readonly notify: (tenantId: TenantId, text: string) => Promise<void>;
  readonly now?: () => Date;
  readonly maxPerRun?: number;
}

export interface PollResult {
  readonly checked: number;
  readonly paid: number;
  readonly expired: number;
}

export async function pollPendingInvoices(deps: PollDeps): Promise<Result<PollResult, Error>> {
  const now = deps.now?.() ?? new Date();
  const pending = await deps.invoices.findPending(deps.maxPerRun ?? 25);
  if (!pending.ok) return err(new Error(pending.error.message));

  let paid = 0;
  let expired = 0;
  for (const inv of pending.value) {
    const st = await deps.gateway.getStatus(inv.orderId);
    if (!st.ok) continue; // transient — coba lagi di run berikutnya

    if (st.value === 'PAID') {
      const tid = inv.tenantId as TenantId;
      // Basis perpanjangan: layanan yang belum lewat diperpanjang, yang lewat mulai dari sekarang.
      const svc = await deps.tenants.getService(tid);
      const base =
        svc.ok && svc.value.serviceEndsAt && new Date(svc.value.serviceEndsAt).getTime() > now.getTime()
          ? new Date(svc.value.serviceEndsAt)
          : now;
      const endsAt = new Date(base.getTime() + inv.periodDays * 86_400_000);

      // Urutan: tandai PAID dulu (idempoten — run berikutnya tak memproses ulang),
      // lalu aktivasi + kabar.
      const marked = await deps.invoices.markStatus(inv.id, 'PAID', now.toISOString());
      if (!marked.ok) continue;
      await deps.tenants.activate(tid, endsAt.toISOString());
      await deps.notify(tid, paymentPaidMessage(endsAt)).catch(() => undefined);
      paid += 1;
    } else if (st.value === 'EXPIRED' || st.value === 'FAILED') {
      const marked = await deps.invoices.markStatus(inv.id, st.value);
      if (!marked.ok) continue;
      // Kebijakan PO: lewat 24 jam tanpa bayar → situs DITAHAN. Jangan menahan tenant
      // yang layanannya masih berjalan (invoice basi dari periode sebelumnya).
      const tid = inv.tenantId as TenantId;
      const svc = await deps.tenants.getService(tid);
      const masihAktif =
        svc.ok && svc.value.serviceEndsAt && new Date(svc.value.serviceEndsAt).getTime() > now.getTime();
      if (!masihAktif) {
        await deps.tenants.hold(tid);
        await deps.notify(tid, paymentExpiredMessage()).catch(() => undefined);
      }
      expired += 1;
    }
  }

  return ok({ checked: pending.value.length, paid, expired });
}
