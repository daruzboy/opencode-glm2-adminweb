// P0 (insiden 2026-07-12): job yang menggantung harus GAGAL pada batas waktu, bukan macet
// di 'active' selamanya. Dua job macet = worker (concurrency 2) beku total TANPA alert —
// karena job yang tak pernah selesai juga tak pernah "gagal".

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_JOB_TIMEOUT_MS, raceJobTimeout } from './chat-inbound-worker.js';

describe('raceJobTimeout — hang senyap → kegagalan terlihat', () => {
  it('job selesai sebelum batas → hasil diteruskan, timer dibersihkan', async () => {
    vi.useFakeTimers();
    try {
      const result = await raceJobTimeout(Promise.resolve('ok'), 1_000, 'j1');
      expect(result).toBe('ok');
      // Tak ada timer tersisa yang bisa menahan proses hidup.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('job MENGGANTUNG → reject [JOB_TIMEOUT] pada batas (BullMQ akan retry + alert)', async () => {
    vi.useFakeTimers();
    try {
      const menggantung = new Promise<never>(() => undefined);
      const pending = raceJobTimeout(menggantung, 5_000, 'j2');
      const expectation = expect(pending).rejects.toThrow('[JOB_TIMEOUT]');
      await vi.advanceTimersByTimeAsync(5_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('job gagal sendiri → error ASLI yang diteruskan (bukan dibungkus timeout)', async () => {
    await expect(
      raceJobTimeout(Promise.reject(new Error('DB down')), 1_000, 'j3'),
    ).rejects.toThrow('DB down');
  });

  // Batas default harus di atas build LLM terlama yang sah (BUILD_LLM_TIMEOUT_MS=180s),
  // supaya timeout menangkap HANG, bukan kerja lambat yang wajar.
  it('default > 180s (build LLM terlama yang sah)', () => {
    expect(DEFAULT_CHAT_JOB_TIMEOUT_MS).toBeGreaterThan(180_000);
  });
});
