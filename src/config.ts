import crypto from "node:crypto";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  typeform: {
    webhookSecret?: string;
  };
  amocrm: {
    baseUrl: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    accessToken?: string;
    refreshToken?: string;
    pipelineId: number;
    initialStatusId?: number;
  };
};

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) return undefined;
  return v;
}

function mustReadEnv(name: string): string {
  const v = readEnv(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer env var ${name}=${value}`);
  return n;
}

function normalizeBaseUrl(name: string, raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    throw new Error(`Invalid URL in env var ${name}`);
  }
}

export function getConfig(): AppConfig {
  const port = toInt("PORT", readEnv("PORT")) ?? 3000;
  const databaseUrl = mustReadEnv("DATABASE_URL");

  const amoBaseUrl = normalizeBaseUrl("AMOCRM_BASE_URL", readEnv("AMOCRM_BASE_URL") ?? "https://example.amocrm.ru");
  const pipelineId = toInt("AMOCRM_PIPELINE_ID", readEnv("AMOCRM_PIPELINE_ID")) ?? 10482294;

  return {
    port,
    databaseUrl,
    typeform: {
      webhookSecret: readEnv("TYPEFORM_WEBHOOK_SECRET")
    },
    amocrm: {
      baseUrl: amoBaseUrl,
      clientId: readEnv("AMOCRM_CLIENT_ID"),
      clientSecret: readEnv("AMOCRM_CLIENT_SECRET"),
      redirectUri: readEnv("AMOCRM_REDIRECT_URI"),
      accessToken: readEnv("AMOCRM_ACCESS_TOKEN"),
      refreshToken: readEnv("AMOCRM_REFRESH_TOKEN"),
      pipelineId,
      initialStatusId: toInt("AMOCRM_INITIAL_STATUS_ID", readEnv("AMOCRM_INITIAL_STATUS_ID"))
    }
  };
}

export function typeformIsSignatureValid(params: {
  secret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): boolean {
  const { secret, rawBody, signatureHeader } = params;
  if (!signatureHeader) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const got = signatureHeader.slice(prefix.length);
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(got);
  if (expectedBuf.length !== gotBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, gotBuf);
}
