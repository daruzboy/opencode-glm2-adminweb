import { describe, it, expect } from 'vitest';
import {
  defaultPublishJobOptions,
  PUBLISH_JOB_POLICY_DEFAULTS,
} from '../publish-job-options.js';

describe('defaultPublishJobOptions', () => {
  it('tanpa policy → default retry backoff eksponensial + retensi dead-letter', () => {
    expect(defaultPublishJobOptions()).toEqual({
      attempts: PUBLISH_JOB_POLICY_DEFAULTS.attempts,
      backoff: { type: 'exponential', delay: PUBLISH_JOB_POLICY_DEFAULTS.backoffDelayMs },
      // Sukses dipangkas (batas angka), gagal disimpan semua → dead-letter audit.
      removeOnComplete: PUBLISH_JOB_POLICY_DEFAULTS.keepCompleted,
      removeOnFail: true,
    });
  });

  it('policy override attempts + backoff + retensi diteruskan apa adanya', () => {
    const opts = defaultPublishJobOptions({
      attempts: 5,
      backoffDelayMs: 1000,
      keepCompleted: false,
      keepFailed: 100,
    });
    expect(opts).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: false,
      removeOnFail: 100,
    });
  });

  it('attempts=1 → tanpa retry (hanya percobaan pertama)', () => {
    expect(defaultPublishJobOptions({ attempts: 1 }).attempts).toBe(1);
  });
});
