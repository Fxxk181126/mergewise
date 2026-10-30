const RULE_PATTERN = /(?:^|[^\w-])rule[:\s]+`?([A-Za-z0-9._/-]+)`?/i;

export function extractRule(body: string): string | null {
  return body.match(RULE_PATTERN)?.[1] ?? null;
}

export async function resolveMutedRule(input: {
  body: string;
  inReplyTo?: () => Promise<{ body?: string }>;
}): Promise<string | null> {
  const explicitRule = extractRule(input.body);
  if (explicitRule) return explicitRule;

  if (!input.inReplyTo) return null;
  const parent = await input.inReplyTo();
  return parent.body ? extractRule(parent.body) : null;
}
