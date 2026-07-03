// Port: audit log lintas use case (SRS §5.4, §8).
// Implementasi konkret hidup di adapters; core hanya bergantung kontrak ini.

import type { Port, Result, TenantId } from '../index.js';

export interface AuditLogRecord {
  readonly actor: string;
  readonly tenantId?: TenantId;
  readonly action: string;
  readonly meta: unknown;
}

export interface AuditLogError {
  readonly code: 'UNKNOWN';
  readonly message: string;
}

export interface AuditLogPort extends Port {
  record(record: AuditLogRecord): Promise<Result<void, AuditLogError>>;
}
