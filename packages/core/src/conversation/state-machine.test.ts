import { describe, expect, it } from 'vitest';
import type { ConversationState } from '@digimaestro/shared';
import { advanceState } from './state-machine.js';

const STATES: ConversationState[] = [
  'ONBOARDING',
  'INTERVIEW',
  'BUILDING',
  'REVIEW',
  'IDLE',
  'SUPPORT',
];

describe('advanceState — transisi (state, intent) murni', () => {
  it('intent interview → selalu masuk INTERVIEW + START_INTERVIEW', () => {
    for (const s of STATES) {
      const t = advanceState(s, 'interview');
      expect(t.state).toBe('INTERVIEW');
      expect(t.action).toBe('START_INTERVIEW');
    }
  });

  it('intent revision saat ada situs (BUILDING/REVIEW) → REVIEW + HANDLE_REVISION', () => {
    for (const s of ['BUILDING', 'REVIEW'] as const) {
      const t = advanceState(s, 'revision');
      expect(t.state).toBe('REVIEW');
      expect(t.action).toBe('HANDLE_REVISION');
    }
  });

  it('intent revision tanpa situs → state tetap + FALLBACK', () => {
    for (const s of ['ONBOARDING', 'INTERVIEW', 'IDLE', 'SUPPORT'] as const) {
      const t = advanceState(s, 'revision');
      expect(t.state).toBe(s);
      expect(t.action).toBe('FALLBACK');
    }
  });

  it('intent status → state tak berubah + REPORT_STATUS', () => {
    for (const s of STATES) {
      const t = advanceState(s, 'status');
      expect(t.state).toBe(s);
      expect(t.action).toBe('REPORT_STATUS');
    }
  });

  it('intent other → state tak berubah + FALLBACK', () => {
    for (const s of STATES) {
      const t = advanceState(s, 'other');
      expect(t.state).toBe(s);
      expect(t.action).toBe('FALLBACK');
    }
  });
});
