import { bench, describe } from 'vitest';
import { compactCode } from '../../src/parsers/compact-mode';

// Generate 1000 lines of TypeScript with comments
function generateSource(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 5 === 0) lines.push(`/** Doc for item ${i} */`);
    else if (i % 7 === 0) lines.push(`  // inline comment ${i}`);
    else lines.push(`  const item${i} = transform(input${i});`);
  }
  return lines.join('\n');
}

describe('compact mode benchmarks', () => {
  const source = generateSource(1000);

  bench('compact 1000 TypeScript lines', () => {
    compactCode(source);
  }, { time: 5_000 });
});
