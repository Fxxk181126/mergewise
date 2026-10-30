CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 80,
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'commenting')),
  shadow_started_at INTEGER
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  started_at INTEGER,
  findings TEXT,
  posted_review_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (repo_id, pr_number, head_sha)
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  finding TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_stats (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  published_count INTEGER NOT NULL DEFAULT 0,
  false_positive_count INTEGER NOT NULL DEFAULT 0,
  auto_state TEXT NOT NULL DEFAULT 'active' CHECK (auto_state IN ('active', 'muted')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, rule)
);

CREATE INDEX IF NOT EXISTS reviews_queue_idx ON reviews (status, created_at);
CREATE INDEX IF NOT EXISTS observations_repo_idx ON observations (repo_id, pr_number, head_sha);
