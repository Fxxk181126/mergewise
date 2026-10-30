import type { DiffFile, LineMap } from './types.js';

export function parseLineMaps(patch: string): { [newLine: number]: string } {
  const map: { [newLine: number]: string } = {};
  let newLine: number | null = null;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (newLine === null || line.startsWith('\\')) continue;

    if (line.startsWith('+')) {
      map[newLine] = line.slice(1);
      newLine++;
    } else if (line.startsWith('-')) {
      continue;
    } else {
      map[newLine] = line.startsWith(' ') ? line.slice(1) : line;
      newLine++;
    }
  }
  return map;
}

export function buildLineMaps(files: DiffFile[]): LineMap {
  const maps: LineMap = {};
  for (const f of files) {
    maps[f.path] = parseLineMaps(f.patch);
  }
  return maps;
}

export function totalLines(files: DiffFile[]): number {
  return files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
}
