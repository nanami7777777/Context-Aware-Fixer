import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('project setup', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2);
  });

  it('fast-check works', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
    );
  });
});
