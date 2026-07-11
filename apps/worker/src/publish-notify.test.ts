// T-032tg: aturan SIAPA yang dikabari & KAPAN. Fungsi murni → teruji tanpa Redis/BullMQ.
import { describe, expect, it } from 'vitest';
import { notifyTarget, shouldNotifyFailure } from './publish-worker.js';
import type { PublishJobData, RollbackJobData } from './publish-job.js';
import type { JobLogView } from './publish-observability.js';

const publishJob: PublishJobData = {
  kind: 'publish',
  tenantId: 't1',
  websiteId: 'w1',
  revisionNumber: 2,
  slug: 'warung',
  baseUrl: 'https://warung.digimaestro.id',
  siteDocument: {},
};

const rollbackJob: RollbackJobData = {
  kind: 'rollback',
  tenantId: 't1',
  websiteId: 'w1',
  revisionNumber: 1,
  slug: 'warung',
};

function view(over: Partial<JobLogView> = {}): JobLogView {
  return {
    attemptsMade: 3,
    data: { kind: 'publish', websiteId: 'w1', slug: 'warung' },
    opts: { attempts: 3 },
    ...over,
  } as JobLogView;
}

describe('notifyTarget — siapa yang dikabari', () => {
  it('job publish dengan tenantId → tenant itu', () => {
    expect(notifyTarget(publishJob)).toBe('t1');
  });

  // Rollback bukan aksi yang diminta pengguna lewat chat.
  it('rollback → tak ada yang dikabari', () => {
    expect(notifyTarget(rollbackJob)).toBeNull();
  });

  // Job yang sudah antre SEBELUM versi ini tak punya tenantId → dilewati, bukan crash.
  it('job lama tanpa tenantId → null (job tetap terbit)', () => {
    const legacy = { ...publishJob, tenantId: undefined };
    expect(notifyTarget(legacy)).toBeNull();
  });
});

describe('shouldNotifyFailure — kabari hanya saat retry habis', () => {
  // Inti aturannya: kegagalan transien (masih ada sisa percobaan) tidak boleh membuat
  // pengguna panik — sedetik lagi mungkin berhasil.
  it('percobaan masih tersisa → JANGAN kabari', () => {
    expect(shouldNotifyFailure(view({ attemptsMade: 1, opts: { attempts: 3 } }), publishJob)).toBe(
      false,
    );
  });

  it('percobaan terakhir habis (dead-letter) → kabari', () => {
    expect(shouldNotifyFailure(view({ attemptsMade: 3, opts: { attempts: 3 } }), publishJob)).toBe(
      true,
    );
  });

  it('dead-letter tapi rollback → tetap tidak dikabari', () => {
    expect(shouldNotifyFailure(view(), rollbackJob)).toBe(false);
  });

  it('dead-letter tapi job tanpa tenantId → tidak dikabari', () => {
    expect(shouldNotifyFailure(view(), { ...publishJob, tenantId: undefined })).toBe(false);
  });
});
