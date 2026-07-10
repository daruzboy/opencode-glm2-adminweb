import { describe, it, expect } from 'vitest';
import {
  formatJobStart,
  formatJobSuccess,
  formatJobFailure,
  isDeadLetter,
  type JobLogView,
} from './publish-observability.js';

function job(over: Partial<JobLogView> = {}): JobLogView {
  return {
    id: 'j1',
    attemptsMade: 0,
    data: { kind: 'publish', websiteId: 'w1', slug: 'warung-demo' },
    opts: { attempts: 3 },
    ...over,
  };
}

describe('publish observability formatters', () => {
  it('formatJobStart → prefix + tag + nomor attempt (attemptsMade+1)', () => {
    const line = formatJobStart(job({ attemptsMade: 1 }));
    expect(line).toContain('[publish-worker] mulai');
    expect(line).toContain('job=j1 kind=publish website=w1 slug=warung-demo');
    expect(line).toContain('attempt=2');
  });

  it('formatJobSuccess → durasi_ms', () => {
    expect(formatJobSuccess(job(), 1234)).toContain('sukses');
    expect(formatJobSuccess(job(), 1234)).toContain('durasi_ms=1234');
  });

  it('gagal belum final → label "gagal" + attempt=x/max', () => {
    const line = formatJobFailure(job({ attemptsMade: 1 }), 'DEPLOY down');
    expect(line).toContain(' gagal ');
    expect(line).toContain('attempt=1/3');
    expect(line).toContain('alasan=DEPLOY down');
    expect(line).not.toContain('DEAD-LETTER');
  });

  it('percobaan terakhir habis → DEAD-LETTER', () => {
    const dead = job({ attemptsMade: 3 });
    expect(isDeadLetter(dead)).toBe(true);
    expect(formatJobFailure(dead, 'boom')).toContain('DEAD-LETTER');
  });

  it('id/tag hilang → fallback "unknown"/"-"', () => {
    const bare: JobLogView = { id: null, attemptsMade: 0, data: {} };
    const line = formatJobStart(bare);
    expect(line).toContain('job=unknown');
    expect(line).toContain('website=- slug=-');
    // opts undefined → max default 1 → attemptsMade 0 belum dead-letter.
    expect(isDeadLetter(bare)).toBe(false);
  });
});
