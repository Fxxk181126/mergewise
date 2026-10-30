import type { AnchoredFinding, Finding, LineMap } from './types.js';

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function fuzzySearch(lineMap: { [newLine: number]: string }, quote: string, from: number, range: number): number | null {
  const target = normalize(quote);
  for (let offset = -range; offset <= range; offset++) {
    const ln = from + offset;
    if (ln <= 0) continue;
    const content = lineMap[ln];
    if (content && normalize(content).includes(target)) return ln;
  }
  return null;
}

export function anchor(findings: Finding[], lineMaps: LineMap): { valid: AnchoredFinding[]; invalid: Finding[] } {
  const valid: AnchoredFinding[] = [];
  const invalid: Finding[] = [];

  for (const f of findings) {
    const lineMap = lineMaps[f.file];
    if (!lineMap) {
      invalid.push(f);
      continue;
    }

    if (f.endLine !== undefined && (f.endLine < f.line || !lineMap[f.endLine])) {
      invalid.push(f);
      continue;
    }

    const exact = lineMap[f.line];
    if (exact && normalize(exact) === normalize(f.quote)) {
      valid.push({ ...f, anchored: true });
      continue;
    }

    const fuzzyHit = fuzzySearch(lineMap, f.quote, f.line, 5);
    if (fuzzyHit !== null) {
      valid.push({ ...f, line: fuzzyHit, anchored: true });
      continue;
    }

    invalid.push(f);
  }

  return { valid, invalid };
}
