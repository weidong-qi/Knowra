// 与 P0 冻结的 SQLite v4 DDL 保持一致。
export const AI_SQLITE_DDL = `
CREATE TABLE ai_scope_snapshots (
  scope_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_epoch TEXT NOT NULL,
  space_id TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_scope_snapshots_dataset ON ai_scope_snapshots(dataset_id, dataset_epoch, space_id);

CREATE TABLE ai_context_manifests (
  manifest_id TEXT PRIMARY KEY,
  scope_snapshot_id TEXT NOT NULL REFERENCES ai_scope_snapshots(scope_snapshot_id),
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_epoch TEXT NOT NULL,
  space_id TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_context_manifests_scope ON ai_context_manifests(scope_snapshot_id);

CREATE TABLE ai_grants (
  grant_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  entrypoint TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_epoch TEXT NOT NULL,
  space_id TEXT NOT NULL,
  scope_snapshot_id TEXT NOT NULL REFERENCES ai_scope_snapshots(scope_snapshot_id),
  scope_hash TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL,
  action_kinds_json TEXT NOT NULL,
  max_targets INTEGER NOT NULL CHECK(max_targets BETWEEN 0 AND 20),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX ai_grants_scope ON ai_grants(owner_id, dataset_id, dataset_epoch, space_id, expires_at);

CREATE TABLE ai_jobs (
  job_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  parent_job_id TEXT,
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_epoch TEXT NOT NULL,
  space_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES ai_grants(grant_id),
  job_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  manifest_id TEXT NOT NULL REFERENCES ai_context_manifests(manifest_id),
  manifest_hash TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  result_schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','retrying','cancelling','cancelled','succeeded','failed')),
  phase TEXT NOT NULL,
  accepted_attempt_id TEXT,
  output_hash TEXT,
  question TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, dataset_id, space_id, job_kind, idempotency_key)
);
CREATE INDEX ai_jobs_claim ON ai_jobs(status, updated_at);
CREATE INDEX ai_jobs_dataset ON ai_jobs(dataset_id, dataset_epoch, space_id, created_at);

CREATE TABLE ai_job_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(job_id),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 4),
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  provider_request_id TEXT,
  delivery_uncertain INTEGER NOT NULL CHECK(delivery_uncertain IN (0,1)),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_id, ordinal),
  UNIQUE(job_id, lease_generation)
);
CREATE INDEX ai_attempts_lease ON ai_job_attempts(lease_expires_at, status);

CREATE TABLE ai_actions (
  action_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(job_id),
  grant_id TEXT NOT NULL REFERENCES ai_grants(grant_id),
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_epoch TEXT NOT NULL,
  space_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  target_ids_json TEXT NOT NULL,
  baseline_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  plan_schema_version INTEGER NOT NULL CHECK(plan_schema_version = 1),
  plan_json TEXT NOT NULL,
  approval_ref TEXT,
  status TEXT NOT NULL CHECK(status IN ('planned','awaitingApproval','authorized','applying','applied','rejected','cancelled','expired','conflicted','failed')),
  receipt_hash TEXT,
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, dataset_id, operation_id)
);
CREATE INDEX ai_actions_job ON ai_actions(job_id, status);

CREATE TABLE ai_usage_records (
  usage_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(job_id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES ai_job_attempts(attempt_id),
  beijing_day TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency = 'CNY'),
  price_version TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reserved_microunits INTEGER NOT NULL CHECK(reserved_microunits BETWEEN 0 AND 2000000),
  actual_microunits INTEGER CHECK(actual_microunits >= 0),
  usage_unknown INTEGER NOT NULL CHECK(usage_unknown IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX ai_usage_day ON ai_usage_records(beijing_day, job_id);

CREATE TABLE ai_job_events (
  job_id TEXT NOT NULL REFERENCES ai_jobs(job_id),
  sequence INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  safe_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(job_id, sequence)
);

`;

// 只读结构核对与升级共用相同的所属 schema，避免各自维护列清单。
export const AI_ACCESS_SQLITE_DDL = `
      CREATE TABLE IF NOT EXISTS ai_access_policies (
        policy_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
        dataset_epoch TEXT NOT NULL, space_id TEXT NOT NULL, revision INTEGER NOT NULL,
        record_hash TEXT NOT NULL, record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_access_policies_owner ON ai_access_policies(owner_id, dataset_id, dataset_epoch, space_id);
      CREATE TABLE IF NOT EXISTS ai_run_grants (
        grant_id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES ai_access_policies(policy_id),
        owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_epoch TEXT NOT NULL,
        space_id TEXT NOT NULL, record_hash TEXT NOT NULL, record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_run_grants_policy ON ai_run_grants(policy_id);
      CREATE TABLE IF NOT EXISTS ai_request_manifests (
        manifest_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES ai_run_grants(grant_id),
        owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_epoch TEXT NOT NULL,
        space_id TEXT NOT NULL, record_hash TEXT NOT NULL, record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_request_manifests_grant ON ai_request_manifests(grant_id);
    `;

export const AI_CONVERSATION_SQLITE_DDL = `CREATE TABLE IF NOT EXISTS ai_conversation_records (
      kind TEXT NOT NULL, record_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL, dataset_epoch TEXT NOT NULL, space_id TEXT NOT NULL,
      record_hash TEXT NOT NULL, record_json TEXT NOT NULL,
      PRIMARY KEY (kind, record_id)
    );
    CREATE INDEX IF NOT EXISTS ai_conversation_scope ON ai_conversation_records(owner_id, dataset_id, dataset_epoch, space_id, kind);`;
