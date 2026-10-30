import type { AnchoredFinding, Finding } from './types.js';

export function buildInlineComment(f: AnchoredFinding): string {
  const sevLabel = { security: 'P0 · SECURITY', bug: 'P0 · BUG', test: 'MISSING TEST' }[f.severity];
  let body = `**${sevLabel}** · ${f.title}\n\n`;
  body += `${f.why}\n`;
  if (f.suggestion) {
    body += `\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`\n`;
  }
  body += `\n> 回复 \`@mergewise mute this\` 静音此类 · rule: \`${f.rule}\` · 置信度 ${f.confidence}%\n`;
  return body;
}

export function buildSummaryBody(inline: AnchoredFinding[], summary: AnchoredFinding[], invalid: Finding[]): string {
  const total = inline.length + summary.length;
  if (total === 0) {
    return '## MergeWise Review\n\n本次审查未发现达到置信度阈值的问题。低置信度发现已进入待观察池。';
  }

  let body = '## MergeWise Review\n\n';
  if (invalid.length > 0) {
    body += `另有 ${invalid.length} 条发现因行锚定未通过已合并至待观察池。\n\n`;
  }

  const all = [...inline, ...summary];
  body += '| 文件 | 行 | 级别 | 置信度 | 说明 |\n|---|---|---|---|---|\n';
  for (const f of all) {
    const loc = `${f.file} L${f.line}`;
    body += `| ${loc} | ${f.line} | ${f.severity} | ${f.confidence}% | ${f.title} |\n`;
  }
  body += `\n> 回复 \`@mergewise mute this\` 静音指定规则 · MergeWise 生成`;
  return body;
}
