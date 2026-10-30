import { z } from 'zod';
import { env } from './env.js';
import { LLM_TIMEOUT_MS } from './types.js';
import type { DiffFile, Finding } from './types.js';

const findingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  quote: z.string().min(1),
  severity: z.enum(['bug', 'security', 'test']),
  confidence: z.number().int().min(0).max(100),
  rule: z.string().min(1),
  title: z.string().min(1).max(80),
  why: z.string().min(1).max(200),
  suggestion: z.string().optional(),
});

const responseSchema = z.object({ findings: z.array(findingSchema) });

const SYSTEM_PROMPT = `你是资深代码审查员。只允许基于给定 diff 与上下文事实发言；
不评论风格/格式/性能；不确定就降低 confidence；每条 finding 必须给出
可直接执行的 suggestion（替换内容行数不限）。severity 只允许 bug / security / test。
每条 finding 必须输出 quote（对应行原文，用于行锚定校验）和 rule（内部规则标识如 sql-injection/v3）。
输出仅一个 JSON 对象：
{ "findings": [ { "file", "line", "endLine?", "quote", "severity", "confidence", "rule", "title", "why", "suggestion?" } ] }
confidence 标准化为整数：95+ 代码可证；80–94 高度可能；<75 存疑。`;

function buildUserPrompt(files: DiffFile[]): string {
  const parts = files.map((f) => {
    const lines = formatPatchForLLM(f.patch);
    return `### FILE: ${f.path}\n${lines}`;
  });
  return `审查以下 diff，输出 JSON findings：\n\n${parts.join('\n\n')}`;
}

export function formatPatchForLLM(patch: string): string {
  let newLine: number | null = null;

  return patch.split('\n').map((line) => {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      return line;
    }
    if (newLine === null || line.startsWith('\\')) return line;
    if (line.startsWith('-')) return `-: ${line}`;

    const label = `${newLine}: ${line}`;
    newLine++;
    return label;
  }).join('\n');
}

export interface AnalyzeDeps {
  fetchImpl?: typeof fetch;
  logger?: { warn(message: string): void };
}

export async function analyze(files: DiffFile[], deps: AnalyzeDeps = {}): Promise<Finding[]> {
  if (files.length === 0) return [];
  const fetchImpl = deps.fetchImpl ?? fetch;
  const logger = deps.logger ?? console;

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(`${env.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.llmApiKey}` },
        body: JSON.stringify({
          model: env.llmModel,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(files) },
          ],
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`LLM API ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM did not return valid JSON');

      const parsed = responseSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) {
        console.error('[analyze] zod validation failed:', parsed.error.flatten());
        throw new Error('LLM output failed schema validation');
      }

      return parsed.data.findings as Finding[];
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      logger.warn(JSON.stringify({
        level: 'warn',
        msg: 'LLM call retry',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  throw lastError;
}
