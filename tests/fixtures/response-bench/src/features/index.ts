import { handleItem1 } from './feature-1.js';
import { handleItem2 } from './feature-2.js';
import { handleItem3 } from './feature-3.js';
import { handleItem4 } from './feature-4.js';
import { handleItem5 } from './feature-5.js';
import { handleItem6 } from './feature-6.js';
import { handleItem7 } from './feature-7.js';
import { handleItem8 } from './feature-8.js';
import { handleItem9 } from './feature-9.js';
import { handleItem10 } from './feature-10.js';

export function runAll(value: number): number[] {
  return [
    handleItem1(value),
    handleItem2(value),
    handleItem3(value),
    handleItem4(value),
    handleItem5(value),
    handleItem6(value),
    handleItem7(value),
    handleItem8(value),
    handleItem9(value),
    handleItem10(value),
  ];
}
