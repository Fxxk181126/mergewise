import { z } from 'zod';
import type { DiffFile, Finding } from '../types.js';
import { LLM_TIMEOUT_MS } from '../types.js';

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
可直接执行的 suggestion。severity 只允许 bug / security / test。
每条 finding 必须输出 quote（对应行原文，用于行锚定校验）和 rule。
输出仅一个 JSON 对象。findings 每项字段名必须使用英文，精确为：
file, line, endLine, quote, severity, confidence, rule, title, why, suggestion。
confidence 是 0-100 的整数。title 不超过 80 字符，why 不超过 200 字符。不要输出中文键名。`;

function truncateText(value: unknown, maxLength: number): unknown {
  if (typeof value !== 'string' || value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatPatch(patch: string): string {
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
    newLine += 1;
    return label;
  }).join('\n');
}

export interface AnalyzeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  logger?: { warn(message: string): void };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function normalizeFinding(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const raw = value as Record<string, unknown>;
  const aliases: Record<string, string> = {
    文件: 'file',
    文件路径: 'file',
    路径: 'file',
    行: 'line',
    行号: 'line',
    起始行: 'line',
    结束行: 'endLine',
    结束行号: 'endLine',
    原文: 'quote',
    引用: 'quote',
    严重级别: 'severity',
    严重性: 'severity',
    等级: 'severity',
    置信度: 'confidence',
    规则: 'rule',
    规则名: 'rule',
    标题: 'title',
    原因: 'why',
    理由: 'why',
    建议: 'suggestion',
    修复建议: 'suggestion',
  };
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases[key] ?? key] = value;
  }
  normalized.title = truncateText(normalized.title, 80);
  normalized.why = truncateText(normalized.why, 200);
  const confidence = Number(normalized.confidence);
  if (Number.isFinite(confidence)) {
    normalized.confidence = confidence <= 1
      ? Math.round(confidence * 100)
      : Math.round(confidence);
  }
  return normalized;
}

function describeSchemaIssues(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  }).join('; ');
}

function resolveMissingFiles(findings: Finding[], files: DiffFile[]): Finding[] {
  return findings.map((finding) => {
    if (finding.file && finding.file !== 'undefined') return finding;
    const codeFiles = files.filter((file) => /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path));
    const matchingFile = files.find((file) => file.patch.includes(finding.quote.trim()))
      ?? (codeFiles.length === 1 ? codeFiles[0] : undefined);
    return matchingFile ? { ...finding, file: matchingFile.path } : finding;
  });
}

export async function analyze(files: DiffFile[], config: AnalyzeConfig): Promise<Finding[]> {
  if (files.length === 0) return [];
  const fetchImpl = config.fetchImpl ?? fetch;
  const user = `审查以下 diff，输出 JSON findings：\n\n${files.map((file) =>
    `### FILE: ${file.path}\n${formatPatch(file.patch)}`
  ).join('\n\n')}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? LLM_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`LLM API ${response.status}: ${await response.text()}`);

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const match = (data.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
      if (!match) throw new Error('LLM did not return valid JSON');
      const parsed = responseSchema.safeParse({
        findings: JSON.parse(match[0]).findings?.map(normalizeFinding) ?? [],
      });
      if (!parsed.success) {
        const message = 'LLM output failed schema validation';
        config.logger?.warn(`${message}: ${describeSchemaIssues(parsed.error)}`);
        throw new Error(message);
      }
      return resolveMissingFiles(parsed.data.findings, files);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
