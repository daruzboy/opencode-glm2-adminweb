// Konfigurasi LLM runtime (dashboard admin 2026-07-15): PO mengganti model DeepSeek
// (flash/pro), API key, dan harga token dari dashboard — berlaku pada panggilan LLM
// BERIKUTNYA tanpa restart kontainer.
//
// Satu file JSON di folder /runtime (host: /opt/containers/glm2/runtime/, di-mount rw
// hanya di kontainer api; worker membacanya ro). Cache ber-mtime (pola file-sop-provider):
// tiap panggilan hanya stat(); isi dibaca ulang saat file berubah. File hilang/rusak →
// {} (fail-soft: adapter memakai konfigurasi env) — dicatat sekali agar log tak banjir.

import { readFileSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { LlmRuntimeOverrides } from '@digimaestro/shared';

export interface RuntimeLlmConfig {
  readonly model?: string;
  readonly apiKey?: string;
  readonly priceInputPer1M?: number;
  readonly priceOutputPer1M?: number;
}

export interface RuntimeLlmConfigStore {
  readonly path: string;
  // Konfigurasi tersimpan saat ini (cache mtime; sinkron — dipanggil per request LLM).
  get(): RuntimeLlmConfig;
  // Bentuk yang dikonsumsi adapter LLM per panggilan.
  overrides(): LlmRuntimeOverrides;
  // Merge patch → tulis atomik (tmp+rename; fallback tulis-di-tempat utk bind-mount file).
  // String kosong / null menghapus override (kembali ke env).
  save(patch: Partial<Record<keyof RuntimeLlmConfig, unknown>>): Promise<RuntimeLlmConfig>;
}

const MODEL_RE = /^[a-zA-Z0-9._:\/-]{1,64}$/;
const KEY_RE = /^\S{8,200}$/;

function sanitize(raw: unknown): RuntimeLlmConfig {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.model === 'string' && MODEL_RE.test(o.model)) out.model = o.model;
  if (typeof o.apiKey === 'string' && KEY_RE.test(o.apiKey)) out.apiKey = o.apiKey;
  for (const k of ['priceInputPer1M', 'priceOutputPer1M'] as const) {
    const n = Number(o[k]);
    if (o[k] !== undefined && o[k] !== null && Number.isFinite(n) && n >= 0 && n <= 1000) out[k] = n;
  }
  return out as RuntimeLlmConfig;
}

export interface RuntimeLlmConfigStoreOptions {
  readonly path: string;
  readonly logger?: { warn(msg: string): void };
}

export function createRuntimeLlmConfigStore(options: RuntimeLlmConfigStoreOptions): RuntimeLlmConfigStore {
  let cachedMtimeMs = -1;
  let cached: RuntimeLlmConfig = {};
  let warned = false;

  const get = (): RuntimeLlmConfig => {
    try {
      const s = statSync(options.path);
      if (s.mtimeMs !== cachedMtimeMs) {
        cached = sanitize(JSON.parse(readFileSync(options.path, 'utf8')));
        cachedMtimeMs = s.mtimeMs;
        warned = false;
      }
      return cached;
    } catch (e) {
      // File belum ada = keadaan normal (belum ada override); hanya format rusak yang layak warning.
      if (!warned && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        options.logger?.warn(
          `[llm-config] tidak terbaca (${options.path}): ${e instanceof Error ? e.message : String(e)} — memakai konfigurasi env`,
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
    overrides(): LlmRuntimeOverrides {
      const c = get();
      return {
        ...(c.model ? { model: c.model } : {}),
        ...(c.apiKey ? { apiKey: c.apiKey } : {}),
        ...(c.priceInputPer1M !== undefined && c.priceOutputPer1M !== undefined
          ? { price: { inputPer1M: c.priceInputPer1M, outputPer1M: c.priceOutputPer1M } }
          : {}),
      };
    },
    async save(patch): Promise<RuntimeLlmConfig> {
      // Baca segar (bukan cache) agar merge tak menimpa perubahan manual di host.
      const current = await readFile(options.path, 'utf8')
        .then((t) => sanitize(JSON.parse(t)))
        .catch(() => ({}) as RuntimeLlmConfig);
      const merged: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v === null) delete merged[k];
        else if (v !== undefined) merged[k] = v;
      }
      const next = sanitize(merged);
      // Validasi keras: patch berisi nilai yang tak lolos sanitasi = kesalahan input, bukan
      // sesuatu yang boleh hilang diam-diam.
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === null) continue;
        if ((next as Record<string, unknown>)[k] !== (k === 'model' || k === 'apiKey' ? v : Number(v))) {
          throw new Error(`nilai ${k} tidak valid`);
        }
      }
      const body = `${JSON.stringify(next, null, 2)}\n`;
      const tmp = `${options.path}.tmp`;
      try {
        await writeFile(tmp, body, { mode: 0o600 });
        await rename(tmp, options.path);
      } catch {
        // Bind-mount satu-file menolak rename (EBUSY) → tulis di tempat (inode sama).
        await writeFile(options.path, body, { mode: 0o600 });
      }
      cachedMtimeMs = -1; // paksa baca ulang pada get() berikutnya
      return next;
    },
  };
}
