import type { TypeformWebhookPayload } from "./typeform";

type LeadCustomFieldValue = {
  field_id: number;
  values: Array<{ value: string }>;
};

const HIDDEN_TO_LEAD_FIELD_ID: Record<string, number> = {
  utm_content: 214691,
  utm_medium: 214693,
  utm_campaign: 214695,
  utm_source: 214697,
  utm_term: 214699,
  utm_referrer: 214701,
  roistat: 214703,
  referrer: 214705,
  openstat_service: 214707,
  openstat_campaign: 214709,
  openstat_ad: 214711,
  openstat_source: 214713,
  from: 214715,
  gclientid: 214717,
  _ym_uid: 214719,
  _ym_counter: 214721,
  gclid: 214723,
  yclid: 214725,
  fbclid: 214727
};

function parseFieldMap(raw: string | undefined): Record<string, { entity: "lead"; fieldId: number }> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, { entity: "lead"; fieldId: number }>;
  return parsed;
}

export function buildLeadCustomFields(payload: TypeformWebhookPayload): LeadCustomFieldValue[] {
  const hidden = payload.form_response.hidden ?? {};
  const out: LeadCustomFieldValue[] = [];

  for (const [k, v] of Object.entries(hidden)) {
    const fieldId = HIDDEN_TO_LEAD_FIELD_ID[k];
    if (!fieldId) continue;
    if (typeof v !== "string" || v.trim().length === 0) continue;
    out.push({ field_id: fieldId, values: [{ value: v.trim() }] });
  }

  const map = parseFieldMap(process.env.TYPEFORM_FIELD_MAP);
  const answers = payload.form_response.answers ?? [];
  for (const a of answers) {
    const key = a.field.ref ?? a.field.id;
    const mapping = map[key];
    if (!mapping || mapping.entity !== "lead") continue;
    const fieldId = mapping.fieldId;

    let value: string | undefined;
    if (a.text) value = a.text;
    else if (a.email) value = a.email;
    else if (a.phone_number) value = a.phone_number;
    else if (typeof a.boolean === "boolean") value = a.boolean ? "true" : "false";
    else if (typeof a.number === "number") value = String(a.number);
    else if (a.date) value = a.date;
    else if (a.choice?.label) value = a.choice.label;
    else if (a.choices?.labels?.length) value = a.choices.labels.join(", ");

    if (!value || value.trim().length === 0) continue;
    out.push({ field_id: fieldId, values: [{ value: value.trim() }] });
  }

  return out;
}

