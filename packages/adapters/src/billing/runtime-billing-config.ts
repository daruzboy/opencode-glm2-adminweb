// Konfigurasi harga langganan runtime (PO 2026-07-15: "isian khusus agar saya bisa
// setel harga awal dan harga diskon"). Pola sama dgn runtime-llm-config: satu file JSON
// di /runtime (rw hanya di kontainer api — dashboard; worker membaca ro), cache mtime,
// fail-soft {} → jatuh ke env SUBSCRIPTION_PRICE_IDR.
//
// Harga EFEKTIF yang ditagihkan = discountIdr (bila diisi) > priceIdr > env.

import { readFileSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';

export interface RuntimeBillingConfig {
  // Harga normal per periode (rupiah utuh, mis. 89000).
  readonly priceIdr?: number;
  // Harga promo/diskon — bila diisi, INI yang ditagihkan (harga normal tampil dicoret).
  readonly discountIdr?: number;
  readonly periodDays?: number;
}

export interface RuntimeBillingConfigStore {
  readonly path: string;
  get(): RuntimeBillingConfig;
  save(patch: Partial<Record<keyof RuntimeBillingConfig, unknown>>): Promise<RuntimeBillingConfig>;
}

const IDR_MIN = 1_000;
const IDR_MAX = 100_000_000;

function sanitize(raw: unknown): RuntimeBillingConfig {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ['priceIdr', 'discountIdr'] as const) {
    const n = Number(o[k]);
    if (o[k] !== undefined && o[k] !== null && Number.isInteger(n) && n >= IDR_MIN && n <= IDR_MAX) out[k] = n;
  }
  const p = Number(o.periodDays);
  if (o.periodDays !== undefined && o.periodDays !== null && Number.isInteger(p) && p >= 1 && p <= 365) {
    out.periodDays = p;
  }
  // Diskon harus lebih murah dari harga normal — selain itu menyesatkan pelanggan.
  if (out.discountIdr !== undefined && out.priceIdr !== undefined && out.discountIdr >= out.priceIdr) {
    delete out.discountIdr;
  }
  return out as RuntimeBillingConfig;
}

export function createRuntimeBillingConfigStore(options: {
  readonly path: string;
  readonly logger?: { warn(msg: string): void };
}): RuntimeBillingConfigStore {
  let cachedMtimeMs = -1;
  let cached: RuntimeBillingConfig = {};
  let warned = false;

  const get = (): RuntimeBillingConfig => {
    try {
      const s = statSync(options.path);
      if (s.mtimeMs !== cachedMtimeMs) {
        cached = sanitize(JSON.parse(readFileSync(options.path, 'utf8')));
        cachedMtimeMs = s.mtimeMs;
        warned = false;
      }
      return cached;
    } catch (e) {
      if (!warned && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        options.logger?.warn(
          `[billing-config] tidak terbaca (${options.path}): ${e instanceof Error ? e.message : String(e)} — memakai harga env`,
        );
        warned = true;
      }
      cachedMtimeMs = -1;
      cached = {};
      return cached;
    }
  };

  return {
    path: options.path,
    get,
    async save(patch): Promise<RuntimeBillingConfig> {
      const current = await readFile(options.path, 'utf8')
        .then((t) => sanitize(JSON.parse(t)))
        .catch(() => ({}) as RuntimeBillingConfig);
      const merged: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v === null) delete merged[k];
        else if (v !== undefined) merged[k] = v;
      }
      const next = sanitize(merged);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === null) continue;
        if ((next as Record<string, unknown>)[k] !== Number(v)) {
          throw new Error(
            k === 'discountIdr' && Number(v) >= (next.priceIdr ?? Infinity)
              ? 'harga diskon harus lebih murah dari harga normal'
              : `nilai ${k} tidak valid`,
          );
        }
      }
      const body = `${JSON.stringify(next, null, 2)}\n`;
      const tmp = `${options.path}.tmp`;
      try {
        await writeFile(tmp, body, { mode: 0o600 });
        await rename(tmp, options.path);
      } catch {
        await writeFile(options.path, body, { mode: 0o600 });
      }
      cachedMtimeMs = -1;
      return next;
    },
  };
}
