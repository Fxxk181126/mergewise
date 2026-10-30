function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: parseInt(optional('PORT', '3000'), 10),
  databaseUrl: optional('DATABASE_URL', 'postgresql://localhost:5432/mergewise'),
  webhookSecret: required('WEBHOOK_SECRET'),
  githubAppId: required('GITHUB_APP_ID'),
  githubPrivateKey: required('GITHUB_PRIVATE_KEY').replace(/\\n/g, '\n'),
  llmBaseUrl: optional('LLM_BASE_URL', 'https://api.deepseek.com'),
  llmApiKey: required('LLM_API_KEY'),
  llmModel: optional('LLM_MODEL', 'deepseek-chat'),
  defaultThreshold: parseInt(optional('DEFAULT_THRESHOLD', '80'), 10),
};
