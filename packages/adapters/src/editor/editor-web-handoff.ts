// P5: adapter EditorHandoffPort → API editor-web (POST /internal/handoff, service token).
//
// Service token statis (X-Service-Token), BUKAN cookie-JWT manusia: mencetak cookie untuk
// mesin adalah peretasan auth manusia; endpoint internal terpisah membuat pagar & log-nya
// jelas. Kedua app di VPS yang sama → panggilan localhost.
//
// Gagal = gagal KERAS (Result err) — pemanggil (use case build) menandai revisi tetap
// PENDING + alert PO berisi error + endpoint re-trigger; pelanggan tak pernah menggantung
// tanpa penjelasan.

import { err, ok } from '@digimaestro/shared';
import type { EditorHandoffPort, HandoffError, HandoffInput, Result } from '@digimaestro/shared';

export interface EditorWebHandoffOptions {
  // mis. http://127.0.0.1:5181 (API editor-web).
  readonly apiBaseUrl: string;
  // mis. http://<host>:5180 (UI editor — untuk tautan di alert PO).
  readonly appBaseUrl: string;
  readonly serviceToken: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class EditorWebHandoff implements EditorHandoffPort {
  constructor(private readonly options: EditorWebHandoffOptions) {}

  async createProject(
    input: HandoffInput,
  ): Promise<Result<{ projectId: string; editorUrl: string }, HandoffError>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await this.options.fetch(
        `${this.options.apiBaseUrl.replace(/\/$/, '')}/internal/handoff`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-service-token': this.options.serviceToken,
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );

      if (res.status === 401 || res.status === 403) {
        return err({ code: 'AUTH', message: `editor-web menolak service token (HTTP ${res.status})` });
      }
      if (!res.ok) {
        return err({ code: 'HTTP', message: `handoff editor-web HTTP ${res.status}` });
      }

      const body = (await res.json()) as { projectId?: unknown };
      if (typeof body.projectId !== 'string' || !body.projectId) {
        return err({ code: 'HTTP', message: 'respons handoff tanpa projectId' });
      }
      return ok({
        projectId: body.projectId,
        editorUrl: `${this.options.appBaseUrl.replace(/\/$/, '')}/?project=${encodeURIComponent(body.projectId)}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err({ code: 'UNKNOWN', message: `handoff editor-web gagal: ${msg}` });
    } finally {
      clearTimeout(timer);
    }
  }
}
