// Implementasi DashboardSopPort + DashboardSettingsPort (dashboard admin 2026-07-15).
//
// SOP: dua berkas markdown di /runtime (host: /opt/containers/glm2/runtime/, mount rw
// di kontainer api; worker membaca ro). Simpan = tmp+rename (atomik); fallback tulis
// di tempat bila rename ditolak (bind-mount satu-file lama). Bot mengikuti perubahan
// pada pesan berikutnya (file-sop-provider ber-cache mtime).
//
// Pengaturan: pembungkus RuntimeLlmConfigStore — API key TIDAK pernah dikirim balik
// penuh, hanya bentuk tersamar (awal+akhir) untuk konfirmasi visual.

import { readFile, rename, writeFile } from 'node:fs/promises';
import type { LlmTokenPrice } from '@digimaestro/shared';
import type { RuntimeLlmConfigStore } from '@digimaestro/adapters';
import type {
  DashboardSettingsPort,
  DashboardSettingsView,
  DashboardSopDoc,
  DashboardSopPort,
} from './dashboard-routes.js';

// ── SOP ───────────────────────────────────────────────────────────────────────

export interface DashboardSopOptions {
  readonly customerPath?: string;
  readonly adminPath?: string;
}

const SOP_TITLES: Record<'konsumen' | 'admin', string> = {
  konsumen: 'SOP Pelayanan Konsumen',
  admin: 'SOP Konsol Admin',
};

async function writeInPlaceSafe(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  } catch {
    await writeFile(path, text, 'utf8');
  }
}

export function createDashboardSop(opts: DashboardSopOptions): DashboardSopPort | undefined {
  const files: { which: 'konsumen' | 'admin'; path: string }[] = [];
  if (opts.customerPath) files.push({ which: 'konsumen', path: opts.customerPath });
  if (opts.adminPath) files.push({ which: 'admin', path: opts.adminPath });
  if (files.length === 0) return undefined;

  return {
    async list(): Promise<readonly DashboardSopDoc[]> {
      return Promise.all(
        files.map(async (f) => ({
          which: f.which,
          title: SOP_TITLES[f.which],
          path: f.path,
          text: await readFile(f.path, 'utf8').catch(() => ''),
        })),
      );
    },
    async save(which, text): Promise<void> {
      const f = files.find((x) => x.which === which);
      if (!f) throw new Error(`SOP ${which} belum dikonfigurasi`);
      await writeInPlaceSafe(f.path, text);
    },
  };
}

// ── Pengaturan LLM ────────────────────────────────────────────────────────────

export interface DashboardSettingsOptions {
  readonly store: RuntimeLlmConfigStore;
  // Nilai bawaan dari env — ditampilkan sebagai "efektif" saat tak ada override.
  readonly envModel: string;
  readonly envApiKey: string;
  readonly envPrice: LlmTokenPrice;
}

function maskKey(key: string): string | null {
  if (!key) return null;
  return key.length >= 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '(terpasang)';
}

export function createDashboardSettings(opts: DashboardSettingsOptions): DashboardSettingsPort {
  const view = (): DashboardSettingsView => {
    const c = opts.store.get();
    const priceOverridden = c.priceInputPer1M !== undefined && c.priceOutputPer1M !== undefined;
    return {
      model: c.model ?? opts.envModel,
      modelOverridden: c.model !== undefined,
      apiKeyMasked: maskKey(c.apiKey ?? opts.envApiKey),
      apiKeyOverridden: c.apiKey !== undefined,
      priceInputPer1M: priceOverridden ? c.priceInputPer1M! : opts.envPrice.inputPer1M,
      priceOutputPer1M: priceOverridden ? c.priceOutputPer1M! : opts.envPrice.outputPer1M,
      priceOverridden,
    };
  };

  return {
    async get() {
      return view();
    },
    async save(patch) {
      await opts.store.save(patch);
      return view();
    },
  };
}
