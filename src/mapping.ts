import type { TypeformWebhookPayload } from "./typeform";

type LeadCustomFieldValue = {
  field_id: number;
  values: Array<{ value?: string; enum_id?: number }>;
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

const DEFAULT_REFS = {
  fullName: ["fd704be3-ad3e-4290-b60d-7f975b55ae84", "3e231887-ca36-4afd-aefa-119d3c7e710d"],
  childName: ["8c517346-f61c-4275-ae57-1a088af15cfe", "2fa4a64a-dac4-4ace-98a3-18419435d831"],
  childDob: ["d35af5e7-1255-485c-a445-d49d2c682fd2", "98e1c79c-bdb2-4534-bf70-5894ed7e9c2b"],
  desiredProgram: ["f1da7df1-b0b0-4fc7-8cd4-0bf95cfdcd2b", "c90719d9-e6d8-4fbe-9d4b-c05953644281"],
  currentEducation: ["658c6abe-395a-4362-9124-6304202d443b", "b1a6060f-4d88-4be0-ae79-8944452c3c1a"]
};

const LEAD_FIELD = {
  fullName: 985897,
  childName1: 995889,
  childDob1: 995891,
  desiredProgram: 995887,
  currentEducation: 985895
};

const DESIRED_PROGRAM_ENUM = {
  kindergarden: 1222831,
  ibSchool: 1222835,
  consultation: 1222837
};

function toAmoDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return `${s}T00:00:00+00:00`;
}

function getAnswerString(a: NonNullable<TypeformWebhookPayload["form_response"]["answers"]>[number]): string | undefined {
  if (a.text) return a.text;
  if (a.email) return a.email;
  if (a.phone_number) return a.phone_number;
  if (typeof a.boolean === "boolean") return a.boolean ? "true" : "false";
  if (typeof a.number === "number") return String(a.number);
  if (a.date) return toAmoDateTime(a.date);
  if (a.choice?.label) return a.choice.label;
  if (a.choices?.labels?.length) return a.choices.labels.join(", ");
  return undefined;
}

function mapDesiredProgramEnum(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const s = label.trim().toLowerCase();
  if (s.startsWith("ib kg")) return DESIRED_PROGRAM_ENUM.kindergarden;
  if (s.startsWith("pyp")) return DESIRED_PROGRAM_ENUM.ibSchool;
  if (s.startsWith("myp")) return DESIRED_PROGRAM_ENUM.ibSchool;
  if (s.startsWith("dp")) return DESIRED_PROGRAM_ENUM.ibSchool;
  if (s.includes("not sure")) return DESIRED_PROGRAM_ENUM.consultation;
  if (s.includes("не уверен")) return DESIRED_PROGRAM_ENUM.consultation;
  return undefined;
}

export function buildLeadCustomFields(payload: TypeformWebhookPayload): LeadCustomFieldValue[] {
  const hidden = payload.form_response.hidden ?? {};
  const outByFieldId = new Map<number, LeadCustomFieldValue>();

  function put(params: { fieldId: number; value?: string; enumId?: number }) {
    const { fieldId, value, enumId } = params;
    if ((value === undefined || value.trim().length === 0) && enumId === undefined) return;
    outByFieldId.set(fieldId, { field_id: fieldId, values: [{ ...(value ? { value: value.trim() } : {}), ...(enumId ? { enum_id: enumId } : {}) }] });
  }

  for (const [k, v] of Object.entries(hidden)) {
    const fieldId = HIDDEN_TO_LEAD_FIELD_ID[k];
    if (!fieldId) continue;
    if (typeof v !== "string" || v.trim().length === 0) continue;
    put({ fieldId, value: v });
  }

  const answers = payload.form_response.answers ?? [];
  for (const a of answers) {
    const key = a.field.ref ?? a.field.id;

    if (DEFAULT_REFS.fullName.includes(key)) put({ fieldId: LEAD_FIELD.fullName, value: a.text });
    if (DEFAULT_REFS.childName.includes(key)) put({ fieldId: LEAD_FIELD.childName1, value: a.text });
    if (DEFAULT_REFS.childDob.includes(key)) put({ fieldId: LEAD_FIELD.childDob1, value: toAmoDateTime(a.date) });
    if (DEFAULT_REFS.desiredProgram.includes(key)) put({ fieldId: LEAD_FIELD.desiredProgram, enumId: mapDesiredProgramEnum(a.choice?.label) });
    if (DEFAULT_REFS.currentEducation.includes(key)) put({ fieldId: LEAD_FIELD.currentEducation, value: a.choice?.label });
  }

  const map = parseFieldMap(process.env.TYPEFORM_FIELD_MAP);
  for (const a of answers) {
    const key = a.field.ref ?? a.field.id;
    const mapping = map[key];
    if (!mapping || mapping.entity !== "lead") continue;
    const value = getAnswerString(a);
    put({ fieldId: mapping.fieldId, value });
  }

  return Array.from(outByFieldId.values());
}
