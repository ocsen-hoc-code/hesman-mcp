import { describe, it, expect } from 'vitest';
import {
  intArg,
  numberArg,
  InvalidArgumentError,
  withArgValidation,
} from '../../../src/server/args.js';

const opts = { default: 20, min: 1, max: 200 };

describe('intArg', () => {
  it('returns the default when the argument is missing', () => {
    expect(intArg({}, 'topK', opts)).toBe(20);
  });

  it('returns the default when the argument is null', () => {
    expect(intArg({ topK: null }, 'topK', opts)).toBe(20);
  });

  it('returns an in-range integer unchanged', () => {
    expect(intArg({ topK: 42 }, 'topK', opts)).toBe(42);
  });

  it('clamps a negative value to min', () => {
    expect(intArg({ topK: -1 }, 'topK', opts)).toBe(1);
  });

  it('clamps 0 to min when min is above 0', () => {
    expect(intArg({ topK: 0 }, 'topK', opts)).toBe(1);
  });

  it('keeps 0 when min is 0', () => {
    expect(intArg({ contextLines: 0 }, 'contextLines', { default: 5, min: 0, max: 200 })).toBe(0);
  });

  it('clamps a too-large value to max', () => {
    expect(intArg({ topK: 1_000_000 }, 'topK', opts)).toBe(200);
  });

  it('rejects a float', () => {
    expect(() => intArg({ topK: 1.5 }, 'topK', opts)).toThrow(InvalidArgumentError);
  });

  it('rejects a numeric string', () => {
    expect(() => intArg({ topK: '5' }, 'topK', opts)).toThrow(InvalidArgumentError);
  });

  it('rejects NaN', () => {
    expect(() => intArg({ topK: NaN }, 'topK', opts)).toThrow(InvalidArgumentError);
  });

  it('rejects Infinity', () => {
    expect(() => intArg({ topK: Infinity }, 'topK', opts)).toThrow(InvalidArgumentError);
  });

  it('names the argument in the error message', () => {
    expect(() => intArg({ topK: 'x' }, 'topK', opts)).toThrow(/topK/);
  });
});

describe('numberArg', () => {
  const scoreOpts = { default: 0, min: 0, max: 1 };

  it('returns the default when missing', () => {
    expect(numberArg({}, 'minScore', scoreOpts)).toBe(0);
  });

  it('accepts a float in range', () => {
    expect(numberArg({ minScore: 0.35 }, 'minScore', scoreOpts)).toBe(0.35);
  });

  it('clamps out-of-range values', () => {
    expect(numberArg({ minScore: -0.5 }, 'minScore', scoreOpts)).toBe(0);
    expect(numberArg({ minScore: 7 }, 'minScore', scoreOpts)).toBe(1);
  });

  it('rejects strings, NaN and Infinity', () => {
    expect(() => numberArg({ minScore: '0.5' }, 'minScore', scoreOpts)).toThrow(InvalidArgumentError);
    expect(() => numberArg({ minScore: NaN }, 'minScore', scoreOpts)).toThrow(InvalidArgumentError);
    expect(() => numberArg({ minScore: -Infinity }, 'minScore', scoreOpts)).toThrow(InvalidArgumentError);
  });
});

describe('withArgValidation', () => {
  it('turns InvalidArgumentError into an INVALID_INPUT tool error', async () => {
    const handler = withArgValidation(async (args) => {
      intArg(args, 'topK', opts);
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    const result = (await handler({ topK: 'abc' })) as {
      content: Array<{ text?: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text ?? '{}');
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/topK/);
  });

  it('rethrows unrelated errors', async () => {
    const handler = withArgValidation(async () => {
      throw new Error('boom');
    });
    await expect(handler({})).rejects.toThrow('boom');
  });

  it('passes successful results through', async () => {
    const handler = withArgValidation(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    await expect(handler({})).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });
});
