import { add, Calculator, type Person } from './utils';

const john: Person = {
  name: 'John',
  age: 30,
};

export function main(): void {
  const result = add(1, 2);
  const calc = new Calculator(0);
  calc.add(5);
  console.log(formatGreeting('world'));
}

export function formatGreeting(name: string): string {
  return `Hello, ${name}!`;
}

export const VERSION = '1.0.0';

export type Status = 'active' | 'inactive';
