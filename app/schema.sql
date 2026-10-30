CREATE TABLE IF NOT EXISTS repos (
  id BIGINT PRIMARY KEY,
  installation_id BIGINT NOT NULL,
  full_name TEXT NOT NULL,
  threshold INT NOT NULL DEFAULT 80,
  mode TEXT NOT NULL DEFAULT 'shadow',
  shadow_started_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  findings JSONB,
  posted_review_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (repo_id, pr_number, head_sha)
);

CREATE TABLE IF NOT EXISTS observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  finding JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rule_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  rule TEXT NOT NULL,
  published_count INT NOT NULL DEFAULT 0,
  false_positive_count INT NOT NULL DEFAULT 0,
  auto_state TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (repo_id, rule)
);
