import { describe, it, expect } from 'vitest';
import { LateBound } from '../../../src/server/late-bound.js';

class Counter {
  private count = 0;
  readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  increment(): number {
    this.count += 1;
    return this.count;
  }
}

describe('LateBound', () => {
  it('throws a clear error when used before a target is bound', () => {
    const late = new LateBound<Counter>('counter');
    expect(late.isBound).toBe(false);
    expect(() => late.ref.increment()).toThrow(/counter is not available/);
  });

  it('forwards method calls and property reads to the bound target', () => {
    const late = new LateBound<Counter>('counter');
    late.bind(new Counter('a'));
    expect(late.isBound).toBe(true);
    expect(late.ref.label).toBe('a');
    expect(late.ref.increment()).toBe(1);
    expect(late.ref.increment()).toBe(2);
  });

  it('follows a re-bind without the holder of `ref` noticing', () => {
    const late = new LateBound<Counter>('counter');
    const ref = late.ref;
    late.bind(new Counter('a'));
    ref.increment();
    late.bind(new Counter('b'));
    expect(ref.label).toBe('b');
    expect(ref.increment()).toBe(1);
  });

  it('throws again after unbind', () => {
    const late = new LateBound<Counter>('counter');
    late.bind(new Counter('a'));
    late.unbind();
    expect(() => late.ref.label).toThrow(/counter is not available/);
  });
});
