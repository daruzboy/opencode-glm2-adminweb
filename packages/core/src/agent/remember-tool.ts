// Tool agent `remember_customer` (memori per tenant, PO 2026-07-15): agent mencatat
// nama panggilan pelanggan / preferensi penting BEGITU mengetahuinya. Catatan masuk
// TenantProfile → disuntikkan ke prompt tiap giliran (renderProfileContext) → sesi edit
// minggu depan tak mulai dari nol.

import { err, ok } from '@digimaestro/shared';
import type { AgentToolDefinition, TenantProfileRepository } from '@digimaestro/shared';

export interface RememberResult {
  readonly saved: true;
}

export function createRememberCustomerTool(
  profile: TenantProfileRepository,
): AgentToolDefinition<unknown, RememberResult> {
  return {
    name: 'remember_customer',
    description:
      'Simpan informasi PENTING tentang pelanggan ke memori jangka panjang: nama panggilan ' +
      '(customerName) dan/atau satu catatan preferensi singkat (note, mis. "suka warna abu-abu", ' +
      '"jangan pakai foto stok"). Panggil BEGITU kamu mengetahuinya — sekali per fakta, jangan ' +
      'mengulang fakta yang sudah ada di KONTEKS PELANGGAN.',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Nama panggilan pelanggan (mis. "Kak Rina")' },
        note: { type: 'string', description: 'Satu catatan preferensi singkat (maks 1 kalimat)' },
      },
    },
    async execute(input, context) {
      const raw = (input ?? {}) as { customerName?: unknown; note?: unknown };
      const customerName =
        typeof raw.customerName === 'string' && raw.customerName.trim()
          ? raw.customerName.trim().slice(0, 80)
          : undefined;
      const note =
        typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 200) : undefined;
      if (!customerName && !note) {
        return err({ code: 'INVALID_INPUT', message: 'isi customerName dan/atau note' });
      }

      const saved = await profile.upsert(context.tenantId, {
        ...(customerName ? { customerName } : {}),
        ...(note ? { addNote: note } : {}),
      });
      if (!saved.ok) return err({ code: 'UNKNOWN', message: saved.error.message });
      return ok({ saved: true });
    },
  };
}
