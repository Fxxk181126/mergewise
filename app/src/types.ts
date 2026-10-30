export type Severity = 'bug' | 'security' | 'test';
export type ReviewMode = 'shadow' | 'commenting';

export interface Finding {
  file: string;
  line: number;
  endLine?: number;
  quote: string;
  severity: Severity;
  confidence: number;
  rule: string;
  title: string;
  why: string;
  suggestion?: string;
}

export interface AnchoredFinding extends Finding {
  anchored: boolean;
}

export interface DiffFile {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface LineMap {
  [path: string]: { [newLine: number]: string };
}

export interface RepoRecord {
  id: bigint;
  installation_id: bigint;
  full_name: string;
  threshold: number;
  mode: ReviewMode;
  shadow_started_at: Date | null;
}

export type ReviewStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export const SEVERITY_ORDER: Record<Severity, number> = { security: 0, bug: 1, test: 2 };
export const MAX_INLINE_PER_PR = 1;
export const MAX_FILES_PER_REVIEW = 10;
export const JOB_TIMEOUT_MS = 5 * 60 * 1000;
export const LLM_TIMEOUT_MS = 120_000;
export const TOKEN_TTL_MS = 55 * 60 * 1000;
