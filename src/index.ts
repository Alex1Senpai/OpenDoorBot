import express from "express";
import type { Request } from "express";
import { createDb, getLatestSubmissionByLandingId, getSubmissionByToken, upsertSubmission } from "./db";
import { getConfig, typeformIsSignatureValid } from "./config";
import { createAmoClient } from "./amocrm";
import type { TypeformWebhookPayload } from "./typeform";
import { extractContactBits, stringifyAnswers } from "./typeform";
import { buildLeadCustomFields } from "./mapping";

function getRawBody(req: Request): Buffer {
  const body = req.body;
  if (Buffer.isBuffer(body)) return body;
  throw new Error("Expected raw body buffer.");
}

async function main() {
  const config = getConfig();
  const db = await createDb(config.databaseUrl);
  const amo = createAmoClient(config.amocrm);

  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/webhooks/typeform", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
    try {
      const signaturePresent = !!req.header("Typeform-Signature");
      if (config.typeform.webhookSecret) {
        const sig = req.header("Typeform-Signature") ?? undefined;
        const raw = getRawBody(req);
        const ok = typeformIsSignatureValid({ secret: config.typeform.webhookSecret, rawBody: raw, signatureHeader: sig });
        if (!ok) return res.status(401).json({ ok: false, error: "Invalid signature" });
      }

      const raw = getRawBody(req);
      const payload = JSON.parse(raw.toString("utf8")) as TypeformWebhookPayload;
      const responseToken = payload.form_response?.token;
      const formId = payload.form_response?.form_id;
      if (!responseToken || !formId) return res.status(400).json({ ok: false, error: "Invalid payload" });

      console.log(
        JSON.stringify({
          msg: "typeform_webhook_received",
          event_id: payload.event_id,
          event_type: payload.event_type,
          form_id: formId,
          token: responseToken,
          landing_id: payload.form_response?.landing_id,
          signature_present: signaturePresent
        })
      );

      const existingByToken = await getSubmissionByToken(db.pool, responseToken);
      const landingId = payload.form_response.landing_id;
      const existing =
        existingByToken ??
        (landingId ? await getLatestSubmissionByLandingId({ pool: db.pool, formId, landingId }) : undefined);

      if (existing && payload.event_id && existing.last_event_id === payload.event_id) {
        console.log(
          JSON.stringify({
            msg: "typeform_webhook_deduped",
            event_id: payload.event_id,
            form_id: formId,
            token: responseToken,
            amo_lead_id: existing.amo_lead_id
          })
        );
        return res.status(200).json({ ok: true, leadId: existing.amo_lead_id ? Number(existing.amo_lead_id) : undefined });
      }

      const typeformSummary = stringifyAnswers(payload);
      const contact = extractContactBits(payload);
      const leadCustomFields = buildLeadCustomFields(payload);

      const { leadId, contactId } = await amo.createOrUpdateByTypeform({
        pool: db.pool,
        existingLeadId: existing?.amo_lead_id ? Number(existing.amo_lead_id) : undefined,
        existingContactId: existing?.amo_contact_id ? Number(existing.amo_contact_id) : undefined,
        typeformSummary,
        leadCustomFields,
        contact
      });

      await upsertSubmission({
        pool: db.pool,
        formId,
        responseToken,
        landingId,
        submittedAt: payload.form_response.submitted_at,
        lastEventId: payload.event_id,
        lastEventType: payload.event_type,
        amoLeadId: leadId,
        amoContactId: contactId,
        lastPayload: payload
      });

      console.log(
        JSON.stringify({
          msg: "typeform_webhook_processed",
          event_id: payload.event_id,
          form_id: formId,
          token: responseToken,
          amo_lead_id: leadId,
          amo_contact_id: contactId
        })
      );
      return res.status(200).json({ ok: true, leadId, contactId });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(
        JSON.stringify({
          msg: "typeform_webhook_error",
          error: message
        })
      );
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.listen(config.port, () => {
    console.log(`Listening on :${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
