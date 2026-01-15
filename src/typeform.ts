export type TypeformWebhookPayload = {
  event_id?: string;
  event_type?: string;
  form_response: {
    form_id: string;
    token: string;
    landing_id?: string;
    submitted_at?: string;
    hidden?: Record<string, string>;
    definition?: {
      fields?: Array<{ id: string; ref?: string; title?: string }>;
    };
    answers?: Array<{
      type: string;
      field: { id: string; ref?: string };
      text?: string;
      email?: string;
      phone_number?: string;
      boolean?: boolean;
      number?: number;
      date?: string;
      choice?: { label?: string; other?: string };
      choices?: { labels?: string[]; other?: string };
    }>;
  };
};

export function extractContactBits(payload: TypeformWebhookPayload): { name?: string; email?: string; phone?: string } {
  const answers = payload.form_response.answers ?? [];
  let email: string | undefined;
  let phone: string | undefined;
  let name: string | undefined;

  for (const a of answers) {
    if (!email && a.email) email = a.email;
    if (!phone && a.phone_number) phone = a.phone_number;
    if (!name && a.type === "text" && a.text && a.text.trim().length > 1) name = a.text.trim();
  }

  const hidden = payload.form_response.hidden ?? {};
  if (!email && hidden.email) email = hidden.email;
  if (!phone && hidden.phone) phone = hidden.phone;
  if (!name && hidden.name) name = hidden.name;

  return { name, email, phone };
}

export function stringifyAnswers(payload: TypeformWebhookPayload): string {
  const answers = payload.form_response.answers ?? [];
  const definitionFields = payload.form_response.definition?.fields ?? [];
  const titleByKey = new Map<string, string>();
  for (const f of definitionFields) {
    if (f.ref && f.title) titleByKey.set(f.ref, f.title);
    if (f.id && f.title) titleByKey.set(f.id, f.title);
  }

  const parts: string[] = [];
  for (const a of answers) {
    const key = a.field.ref ?? a.field.id;
    const title = titleByKey.get(key);
    let value: string | undefined;
    if (a.text) value = a.text;
    else if (a.email) value = a.email;
    else if (a.phone_number) value = a.phone_number;
    else if (typeof a.boolean === "boolean") value = a.boolean ? "true" : "false";
    else if (typeof a.number === "number") value = String(a.number);
    else if (a.date) value = a.date;
    else if (a.choice?.label) value = a.choice.label;
    else if (a.choices?.labels?.length) value = a.choices.labels.join(", ");
    else value = "(unsupported)";
    parts.push(`${title ?? key}: ${value}`);
  }

  const hidden = payload.form_response.hidden ?? {};
  const hiddenKeys = Object.keys(hidden);
  if (hiddenKeys.length) {
    parts.push("");
    parts.push("hidden:");
    for (const k of hiddenKeys.sort()) parts.push(`${k}: ${hidden[k]}`);
  }

  return parts.join("\n");
}
