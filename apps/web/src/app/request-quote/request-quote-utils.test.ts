import { describe, expect, it } from 'vitest';
import { sanitizeProductHint } from './request-quote-utils';

describe('request quote product context', () => {
  it('preserves an ordinary product slug as a hint', () => {
    expect(sanitizeProductHint('  WB-MR6C  ')).toBe('WB-MR6C');
  });

  it('removes C0 control characters and DEL', () => {
    const controls = `${String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index))}\u007f`;
    expect(sanitizeProductHint(`WB${controls}-MR6C`)).toBe('WB-MR6C');
  });

  it('keeps the existing 120-character limit', () => {
    expect(sanitizeProductHint('X'.repeat(121))).toHaveLength(120);
  });
});
