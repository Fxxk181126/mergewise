import { SEVERITY_ORDER, MAX_INLINE_PER_PR } from './types.js';
import type { AnchoredFinding, Finding, ReviewMode } from './types.js';

export interface FilterOptions {
  mode: ReviewMode;
  threshold: number;
  mutes: Set<string>;
}

export interface FilterResult {
  inline: AnchoredFinding[];
  summary: AnchoredFinding[];
  observed: Finding[];
  muted: Finding[];
}

export function filterFindings(findings: AnchoredFinding[], opts: FilterOptions): FilterResult {
  const inline: AnchoredFinding[] = [];
  const summary: AnchoredFinding[] = [];
  const observed: Finding[] = [];
  const muted: Finding[] = [];

  const aboveThreshold = findings.filter((f) => f.confidence >= opts.threshold);
  const belowThreshold = findings.filter((f) => f.confidence < opts.threshold);

  observed.push(...belowThreshold);

  for (const f of aboveThreshold) {
    if (opts.mutes.has(f.rule)) {
      muted.push(f);
    }
  }

  const active = aboveThreshold.filter((f) => !opts.mutes.has(f.rule));
  const seenFiles = new Set<string>();
  const deduped = active.filter((f) => {
    const key = `${f.file}:${f.rule}`;
    if (seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });

  const sorted = [...deduped].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return sevDiff !== 0 ? sevDiff : b.confidence - a.confidence;
  });

  if (opts.mode === 'commenting') {
    for (const f of sorted) {
      if (inline.length < MAX_INLINE_PER_PR) {
        inline.push(f);
      } else {
        summary.push(f);
      }
    }
  } else {
    observed.push(...sorted);
  }

  return { inline, summary, observed, muted };
}
