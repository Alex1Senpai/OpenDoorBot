import pg from "pg";

export type Db = {
  pool: pg.Pool;
};

export async function createDb(databaseUrl: string): Promise<Db> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });
  await pool.query("SELECT 1");
  await ensureSchema(pool);
  return { pool };
}

async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS typeform_submissions (
      id BIGSERIAL PRIMARY KEY,
      form_id TEXT NOT NULL,
      response_token TEXT NOT NULL UNIQUE,
      landing_id TEXT,
      submitted_at TIMESTAMPTZ,
      last_event_id TEXT,
      last_event_type TEXT,
      amo_lead_id BIGINT,
      amo_contact_id BIGINT,
      last_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE typeform_submissions ADD COLUMN IF NOT EXISTS last_event_id TEXT;`);
  await pool.query(`ALTER TABLE typeform_submissions ADD COLUMN IF NOT EXISTS last_event_type TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS typeform_submissions_landing_idx ON typeform_submissions (form_id, landing_id, updated_at DESC);`);
}

export async function kvGet(pool: pg.Pool, key: string): Promise<string | undefined> {
  const res = await pool.query<{ value: string }>("SELECT value FROM kv_store WHERE key=$1", [key]);
  return res.rows[0]?.value;
}

export async function kvSet(pool: pg.Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `
    INSERT INTO kv_store(key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
  `,
    [key, value]
  );
}

export type SubmissionRow = {
  id: string;
  form_id: string;
  response_token: string;
  landing_id: string | null;
  submitted_at: Date | null;
  last_event_id: string | null;
  last_event_type: string | null;
  amo_lead_id: string | null;
  amo_contact_id: string | null;
  last_payload: unknown | null;
};

export async function getSubmissionByToken(pool: pg.Pool, responseToken: string): Promise<SubmissionRow | undefined> {
  const res = await pool.query<SubmissionRow>(
    `
    SELECT id, form_id, response_token, landing_id, submitted_at, last_event_id, last_event_type, amo_lead_id, amo_contact_id, last_payload
    FROM typeform_submissions
    WHERE response_token=$1
  `,
    [responseToken]
  );
  return res.rows[0];
}

export async function getLatestSubmissionByLandingId(params: {
  pool: pg.Pool;
  formId: string;
  landingId: string;
}): Promise<SubmissionRow | undefined> {
  const { pool, formId, landingId } = params;
  const res = await pool.query<SubmissionRow>(
    `
    SELECT id, form_id, response_token, landing_id, submitted_at, last_event_id, last_event_type, amo_lead_id, amo_contact_id, last_payload
    FROM typeform_submissions
    WHERE form_id=$1 AND landing_id=$2
    ORDER BY updated_at DESC
    LIMIT 1
  `,
    [formId, landingId]
  );
  return res.rows[0];
}

export async function upsertSubmission(params: {
  pool: pg.Pool;
  formId: string;
  responseToken: string;
  landingId?: string;
  submittedAt?: string;
  lastEventId?: string;
  lastEventType?: string;
  amoLeadId?: number;
  amoContactId?: number;
  lastPayload: unknown;
}): Promise<void> {
  const { pool, formId, responseToken, landingId, submittedAt, lastEventId, lastEventType, amoLeadId, amoContactId, lastPayload } = params;

  await pool.query(
    `
    INSERT INTO typeform_submissions (
      form_id, response_token, landing_id, submitted_at, last_event_id, last_event_type, amo_lead_id, amo_contact_id, last_payload, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (response_token)
    DO UPDATE SET
      form_id=EXCLUDED.form_id,
      landing_id=COALESCE(EXCLUDED.landing_id, typeform_submissions.landing_id),
      submitted_at=COALESCE(EXCLUDED.submitted_at, typeform_submissions.submitted_at),
      last_event_id=COALESCE(EXCLUDED.last_event_id, typeform_submissions.last_event_id),
      last_event_type=COALESCE(EXCLUDED.last_event_type, typeform_submissions.last_event_type),
      amo_lead_id=COALESCE(EXCLUDED.amo_lead_id, typeform_submissions.amo_lead_id),
      amo_contact_id=COALESCE(EXCLUDED.amo_contact_id, typeform_submissions.amo_contact_id),
      last_payload=EXCLUDED.last_payload,
      updated_at=NOW();
  `,
    [
      formId,
      responseToken,
      landingId ?? null,
      submittedAt ? new Date(submittedAt) : null,
      lastEventId ?? null,
      lastEventType ?? null,
      amoLeadId ?? null,
      amoContactId ?? null,
      JSON.stringify(lastPayload)
    ]
  );
}
