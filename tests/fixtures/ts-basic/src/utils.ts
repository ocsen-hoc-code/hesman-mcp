/** Adds two numbers */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * A person with a name.
 */
export interface Person {
  name: string;
  age: number;
}

// Not exported — helper
function formatName(first: string, last: string): string {
  return `${first} ${last}`;
}

export class Calculator {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  add(n: number): number {
    this.value += n;
    return this.value;
  }

  getValue(): number {
    return this.value;
  }
}
