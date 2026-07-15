// Port: keluhan & saran pelanggan (dashboard admin, PO 2026-07-15). Dicatat bot via tool
// record_feedback saat pelanggan menyampaikannya di chat → PO meninjau di dashboard.

import type { RepositoryError } from './repository.js';
import type { Port, Result, TenantId } from '../index.js';

export type FeedbackKind = 'keluhan' | 'saran';

export interface FeedbackEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: FeedbackKind;
  readonly text: string;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface FeedbackRepository extends Port {
  readonly name: 'FeedbackRepository';
  create(
    tenantId: TenantId,
    input: { readonly kind: FeedbackKind; readonly text: string },
  ): Promise<Result<FeedbackEntity, RepositoryError>>;
}
