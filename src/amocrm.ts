import { kvGet, kvSet } from "./db";
import type pg from "pg";

type AmoConfig = {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  pipelineId: number;
  initialStatusId?: number;
};

type AmoClient = {
  createOrUpdateByTypeform: (params: {
    pool: pg.Pool;
    existingLeadId?: number;
    existingContactId?: number;
    typeformSummary: string;
    leadCustomFields?: unknown[];
    contact: { name?: string; email?: string; phone?: string };
  }) => Promise<{ leadId: number; contactId?: number }>;
};

const KV_ACCESS = "amocrm.access_token";
const KV_REFRESH = "amocrm.refresh_token";

export function createAmoClient(config: AmoConfig): AmoClient {
  async function getAccessToken(pool: pg.Pool): Promise<string> {
    const fromDb = await kvGet(pool, KV_ACCESS);
    if (fromDb) return fromDb;
    if (config.accessToken) return config.accessToken;
    throw new Error("No amoCRM access token. Set AMOCRM_ACCESS_TOKEN or configure refresh flow.");
  }

  async function maybeRefresh(pool: pg.Pool): Promise<void> {
    const hasOAuth = !!(config.clientId && config.clientSecret && config.redirectUri);
    if (!hasOAuth) return;

    const refreshToken = (await kvGet(pool, KV_REFRESH)) ?? config.refreshToken;
    if (!refreshToken) return;

    const url = new URL("/oauth2/access_token", config.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        redirect_uri: config.redirectUri
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`amoCRM refresh failed: ${res.status} ${text}`);
    }

    const json = (await res.json()) as { access_token: string; refresh_token: string };
    await kvSet(pool, KV_ACCESS, json.access_token);
    await kvSet(pool, KV_REFRESH, json.refresh_token);
  }

  async function amoFetch(params: { pool: pg.Pool; input: URL; init?: RequestInit; retryOn401?: boolean }) {
    const { pool, input, init } = params;
    const retryOn401 = params.retryOn401 ?? true;
    const token = await getAccessToken(pool);
    const res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      }
    });

    if (res.status === 401 && retryOn401) {
      await maybeRefresh(pool);
      return amoFetch({ pool, input, init, retryOn401: false });
    }

    return res;
  }

  async function createContact(params: { pool: pg.Pool; name?: string; email?: string; phone?: string }): Promise<number> {
    const { pool, name, email, phone } = params;
    const url = new URL("/api/v4/contacts", config.baseUrl);
    const customFieldsValues = buildContactCustomFields({ phone, email });

    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "POST",
        body: JSON.stringify([
          {
            name: name ?? email ?? phone ?? "Typeform contact",
            ...(customFieldsValues.length ? { custom_fields_values: customFieldsValues } : {})
          }
        ])
      }
    });
    if (!res.ok) throw new Error(`amoCRM contact create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { _embedded?: { contacts?: Array<{ id: number }> } };
    const contactId = json._embedded?.contacts?.[0]?.id;
    if (!contactId) throw new Error("amoCRM did not return created contact id.");
    return contactId;
  }

  function buildContactCustomFields(params: { phone?: string; email?: string }): Array<{
    field_id: number;
    values: Array<{ value: string; enum_id?: number }>;
  }> {
    const { phone, email } = params;
    const customFieldsValues: Array<{
      field_id: number;
      values: Array<{ value: string; enum_id?: number }>;
    }> = [];

    if (phone) {
      customFieldsValues.push({
        field_id: 214683,
        values: [{ value: phone, enum_id: 115921 }]
      });
    }

    if (email) {
      customFieldsValues.push({
        field_id: 214685,
        values: [{ value: email, enum_id: 115933 }]
      });
    }

    return customFieldsValues;
  }

  async function updateContact(params: {
    pool: pg.Pool;
    contactId: number;
    name?: string;
    email?: string;
    phone?: string;
  }): Promise<void> {
    const { pool, contactId, name, email, phone } = params;
    const customFieldsValues = buildContactCustomFields({ phone, email });
    if (!name && !customFieldsValues.length) return;

    const url = new URL("/api/v4/contacts", config.baseUrl);
    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "PATCH",
        body: JSON.stringify([
          {
            id: contactId,
            ...(name ? { name } : {}),
            ...(customFieldsValues.length ? { custom_fields_values: customFieldsValues } : {})
          }
        ])
      }
    });
    if (!res.ok) throw new Error(`amoCRM contact update failed: ${res.status} ${await res.text()}`);
  }

  async function createLead(params: { pool: pg.Pool; name: string }): Promise<number> {
    const { pool, name } = params;
    const url = new URL("/api/v4/leads", config.baseUrl);
    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "POST",
        body: JSON.stringify([
          {
            name,
            pipeline_id: config.pipelineId,
            ...(config.initialStatusId ? { status_id: config.initialStatusId } : {})
          }
        ])
      }
    });
    if (!res.ok) throw new Error(`amoCRM lead create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { _embedded?: { leads?: Array<{ id: number }> } };
    const leadId = json._embedded?.leads?.[0]?.id;
    if (!leadId) throw new Error("amoCRM did not return created lead id.");
    return leadId;
  }

  async function linkLeadToContact(params: { pool: pg.Pool; leadId: number; contactId: number }): Promise<void> {
    const { pool, leadId, contactId } = params;
    const url = new URL(`/api/v4/leads/${leadId}/link`, config.baseUrl);
    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "POST",
        body: JSON.stringify([{ to_entity_id: contactId, to_entity_type: "contacts" }])
      }
    });
    if (!res.ok) throw new Error(`amoCRM link failed: ${res.status} ${await res.text()}`);
  }

  async function addLeadNote(params: { pool: pg.Pool; leadId: number; text: string }): Promise<void> {
    const { pool, leadId, text } = params;
    const url = new URL(`/api/v4/leads/${leadId}/notes`, config.baseUrl);
    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "POST",
        body: JSON.stringify([{ note_type: "common", params: { text } }])
      }
    });
    if (!res.ok) throw new Error(`amoCRM note create failed: ${res.status} ${await res.text()}`);
  }

  async function updateLeadCustomFields(params: { pool: pg.Pool; leadId: number; customFields: unknown[] }): Promise<void> {
    const { pool, leadId, customFields } = params;
    if (!customFields.length) return;
    const url = new URL("/api/v4/leads", config.baseUrl);
    const res = await amoFetch({
      pool,
      input: url,
      init: {
        method: "PATCH",
        body: JSON.stringify([{ id: leadId, custom_fields_values: customFields }])
      }
    });
    if (!res.ok) throw new Error(`amoCRM lead update failed: ${res.status} ${await res.text()}`);
  }

  async function createOrUpdateByTypeform(params: {
    pool: pg.Pool;
    existingLeadId?: number;
    existingContactId?: number;
    typeformSummary: string;
    leadCustomFields?: unknown[];
    contact: { name?: string; email?: string; phone?: string };
  }): Promise<{ leadId: number; contactId?: number }> {
    const { pool, existingLeadId, existingContactId, typeformSummary, leadCustomFields, contact } = params;

    const leadId =
      existingLeadId ??
      (await createLead({
        pool,
        name: `Typeform: ${contact.email ?? contact.phone ?? "submission"}`
      }));

    const isNewLead = !existingLeadId;
    const hasContactBits = !!(contact.email || contact.phone || contact.name);

    let contactId: number | undefined;
    if (isNewLead) {
      if (hasContactBits) contactId = await createContact({ pool, name: contact.name, email: contact.email, phone: contact.phone });
    } else {
      contactId = existingContactId;
      if (!contactId && hasContactBits) {
        contactId = await createContact({ pool, name: contact.name, email: contact.email, phone: contact.phone });
      }
      if (contactId && hasContactBits) {
        await updateContact({ pool, contactId, name: contact.name, email: contact.email, phone: contact.phone });
      }
    }

    if (contactId) await linkLeadToContact({ pool, leadId, contactId });
    if (leadCustomFields?.length) await updateLeadCustomFields({ pool, leadId, customFields: leadCustomFields });
    await addLeadNote({ pool, leadId, text: typeformSummary });

    return { leadId, contactId };
  }

  return { createOrUpdateByTypeform };
}
