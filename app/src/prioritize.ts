import type { DiffFile } from './types.js';

const WEIGHT_RULES: { pattern: RegExp; weight: number }[] = [
  { pattern: /auth|login|session|token|permission/i, weight: 30 },
  { pattern: /sql|query|migration|db|database/i, weight: 25 },
  { pattern: /payment|invoice|checkout|billing/i, weight: 20 },
  { pattern: /controller|handler|route|endpoint|api/i, weight: 15 },
];

function fileWeight(path: string): number {
  let w = 0;
  for (const r of WEIGHT_RULES) {
    if (r.pattern.test(path)) w += r.weight;
  }
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path)) w -= 20;
  return w;
}

export function prioritize<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => fileWeight(b.path) - fileWeight(a.path));
}
