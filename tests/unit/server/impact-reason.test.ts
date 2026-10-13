import { describe, it, expect } from 'vitest';
import { countLabel } from '../../../src/server/tools/impact-analysis';

describe('impact_analysis reason wording', () => {
  it('names the count in plain words, singular and plural', () => {
    expect(countLabel(1, 'calls')).toBe('1 call');
    expect(countLabel(3, 'calls')).toBe('3 calls');
    expect(countLabel(1, 'import')).toBe('1 import');
    expect(countLabel(2, 'implements')).toBe('2 implementations');
    expect(countLabel(2, undefined)).toBe('2 references');
    expect(countLabel(1, 'something-new')).toBe('1 reference');
  });
});
