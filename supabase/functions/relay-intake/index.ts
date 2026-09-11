import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type Intake = {
  organization_id: string;
  source?: string;
  full_name?: string;
  business?: string;
  email?: string;
  phone?: string;
  sms_consent?: boolean;
  request: string;
  monthly_inquiry_volume?: string;
  idempotency_key?: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-relayops-secret, x-idempotency-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("RELAYOPS_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-relayops-secret") !== expected) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let submissionId: string | null = null;
  let orgId: string | null = null;

  try {
    const body = (await req.json()) as Intake;
    orgId = body.organization_id;
    const email = String(body.email || "").trim().toLowerCase();
    const requestText = String(body.request || "").trim();
    if (!orgId || !email || !requestText) return json({ error: "organization_id, email, and request are required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required" }, 400);

    const suppliedKey = req.headers.get("x-idempotency-key") || body.idempotency_key || "";
    const day = new Date().toISOString().slice(0, 10);
    const idempotencyKey = await sha256(suppliedKey.trim() || `${orgId}|${email}|${requestText}|${body.business || ""}|${day}`);

    const { data: existing } = await supabase.from("intake_submissions").select("id,tester_id,lead_id,status").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing?.status === "completed" || existing?.status === "duplicate") {
      const { data: action } = existing.lead_id
        ? await supabase.from("agent_actions").select("id").eq("lead_id", existing.lead_id).order("created_at", { ascending: false }).limit(1).maybeSingle()
        : { data: null };
      await supabase.from("lifecycle_events").insert({ organization_id: orgId, tester_id: existing.tester_id, lead_id: existing.lead_id, action_id: action?.id || null, event_type: "intake_duplicate", event_status: "recorded", idempotency_key: `duplicate:${idempotencyKey}` }).then(() => undefined);
      return json({ ok: true, duplicate: true, submission_id: existing.id, lead_id: existing.lead_id, action_id: action?.id || null, status: "approval_required", next_step: nextStep() }, 200);
    }

    let { data: tester } = await supabase.from("testers").select("*").eq("organization_id", orgId).ilike("email", email).maybeSingle();
    if (!tester) {
      const inserted = await supabase.from("testers").insert({ organization_id: orgId, email, full_name: body.full_name || null, phone: body.phone || null, sms_consent: body.sms_consent === true, last_intake_at: new Date().toISOString() }).select().single();
      if (inserted.error) {
        const retry = await supabase.from("testers").select("*").eq("organization_id", orgId).ilike("email", email).single();
        if (retry.error) throw inserted.error;
        tester = retry.data;
      } else tester = inserted.data;
    } else {
      const updated = await supabase.from("testers").update({ full_name: body.full_name || tester.full_name, phone: body.phone || tester.phone, sms_consent: body.sms_consent === true || tester.sms_consent, lifecycle_status: "intake_received", last_intake_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", tester.id).select().single();
      if (updated.error) throw updated.error;
      tester = updated.data;
    }

    if (existing) {
      submissionId = existing.id;
      const retried = await supabase.from("intake_submissions").update({ status: "retrying", attempt_count: 1, updated_at: new Date().toISOString(), last_error: null }).eq("id", existing.id).select().single();
      if (retried.error) throw retried.error;
    } else {
      const created = await supabase.from("intake_submissions").insert({ organization_id: orgId, tester_id: tester.id, idempotency_key: idempotencyKey, source: body.source || "korra_web", payload: { business: body.business || null, monthly_inquiry_volume: body.monthly_inquiry_volume || null, request: requestText }, status: "processing", attempt_count: 1 }).select().single();
      if (created.error) throw created.error;
      submissionId = created.data.id;
    }

    let lead: any = null;
    if (existing?.lead_id) {
      const found = await supabase.from("leads").select("*").eq("id", existing.lead_id).maybeSingle();
      lead = found.data;
    }
    if (!lead) {
      const created = await supabase.from("leads").insert({ organization_id: orgId, source: body.source || "korra_web", full_name: body.full_name || null, email, phone: body.phone || null, request: requestText, status: "new" }).select().single();
      if (created.error) throw created.error;
      lead = created.data;
      await supabase.from("intake_submissions").update({ lead_id: lead.id }).eq("id", submissionId);
    }

    let { data: action } = await supabase.from("agent_actions").select("*").eq("lead_id", lead.id).eq("action_type", "draft_lead_reply").maybeSingle();
    let generationError: string | null = null;
    if (!action) {
      const generated = await generateDraft(requestText, body.full_name || "there", body.business || "your business");
      generationError = generated.error;
      const inserted = await supabase.from("agent_actions").insert({ organization_id: orgId, lead_id: lead.id, action_type: "draft_lead_reply", risk: "approval_required", status: "proposed", input: { request: requestText, business: body.business || null }, output: generated.output, error: null }).select().single();
      if (inserted.error) throw inserted.error;
      action = inserted.data;
      await supabase.from("leads").update({ urgency: generated.output.urgency || "normal", status: "awaiting_approval", updated_at: new Date().toISOString() }).eq("id", lead.id);
    }

    const approvalToken = randomToken();
    const feedbackToken = randomToken();
    const approvalHash = await sha256(approvalToken);
    const feedbackHash = await sha256(feedbackToken);
    const approvalUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/approval-action?token=${encodeURIComponent(approvalToken)}`;
    const feedbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tester-feedback?token=${encodeURIComponent(feedbackToken)}`;
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const feedbackExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: settings } = await supabase.from("organization_settings").select("*").eq("organization_id", orgId).single();
    if (!settings?.owner_email) throw new Error("Organization owner email is not configured");
    const ownerEmail = settings.owner_email;
    const appUrl = settings?.app_url || "https://korra-iota.vercel.app";

    const approvalInsert = await supabase.from("approval_requests").upsert({ organization_id: orgId, action_id: action.id, token_hash: approvalHash, expires_at: expiresAt, decision: "pending", email_status: "queued", sms_status: settings?.owner_phone && settings?.owner_sms_consent && settings?.sms_provider ? "queued" : "skipped", updated_at: new Date().toISOString() }, { onConflict: "action_id" }).select().single();
    if (approvalInsert.error) throw approvalInsert.error;

    await supabase.from("intake_submissions").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), feedback_token_hash: feedbackHash, feedback_expires_at: feedbackExpiresAt, last_error: null }).eq("id", submissionId);

    const firstName = String(body.full_name || "there").trim().split(/\s+/)[0] || "there";
    const ackKey = `tester_ack:${submissionId}`;
    const approvalEmailKey = `approval_email:${action.id}`;
    const followupKey = `tester_followup:${submissionId}`;
    const messages = [
      { organization_id: orgId, tester_id: tester.id, channel: "email", message_kind: "tester_acknowledgment", recipient: email, idempotency_key: ackKey, status: "queued", payload: { subject: "Your Korra test request is ready", first_name: firstName, app_url: `${appUrl}/#contact`, feedback_url: feedbackUrl, steps: ["Submit one real workflow problem", "Look for the queued for review confirmation", "Reply with what was easy, confusing, or did not work"], safety: "Nothing is sent, booked, purchased, or changed without approval." } },
      { organization_id: orgId, tester_id: tester.id, channel: "email", message_kind: "tester_followup", recipient: email, idempotency_key: followupKey, status: "queued", next_retry_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), payload: { subject: "How did your Korra test go?", feedback_url: feedbackUrl, app_url: `${appUrl}/#contact` } },
      { organization_id: orgId, action_id: action.id, channel: "email", message_kind: "approval_request", recipient: ownerEmail, idempotency_key: approvalEmailKey, status: "queued", payload: { subject: `Korra approval needed for ${body.full_name || email}`, approval_url: approvalUrl, lead_id: lead.id, action_id: action.id, summary: action.output?.summary || requestText, suggested_reply: action.output?.suggested_reply || "" } },
    ];
    if (settings?.owner_phone && settings?.owner_sms_consent && settings?.sms_provider) messages.push({ organization_id: orgId, action_id: action.id, channel: "sms", message_kind: "approval_request", recipient: settings.owner_phone, idempotency_key: `approval_sms:${action.id}`, status: "queued", payload: { approval_url: approvalUrl, action_id: action.id, correlation_id: approvalInsert.data.sms_correlation_id } } as any);
    const queued = await supabase.from("outbound_messages").upsert(messages, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (queued.error) throw queued.error;

    await supabase.from("testers").update({ lifecycle_status: "acknowledged", acknowledgment_status: "queued", followup_status: "queued", followup_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", tester.id);
    await supabase.from("lifecycle_events").upsert([
      { organization_id: orgId, tester_id: tester.id, lead_id: lead.id, action_id: action.id, event_type: "intake_completed", idempotency_key: `intake_completed:${submissionId}`, details: { submission_id: submissionId, duplicate: false, generation_fallback: Boolean(generationError) } },
      { organization_id: orgId, tester_id: tester.id, lead_id: lead.id, action_id: action.id, event_type: "outreach_queued", idempotency_key: `outreach_queued:${submissionId}`, details: { acknowledgment: ackKey, followup: followupKey, approval_email: approvalEmailKey } },
    ], { onConflict: "idempotency_key", ignoreDuplicates: true });

    return json({ ok: true, duplicate: false, submission_id: submissionId, tester_id: tester.id, lead_id: lead.id, action_id: action.id, status: "approval_required", next_step: nextStep(), receipt: { acknowledgment: "queued", approval: "queued", sms: approvalInsert.data.sms_status } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (submissionId) await supabase.from("intake_submissions").update({ status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("id", submissionId);
    if (orgId) await supabase.from("lifecycle_events").insert({ organization_id: orgId, event_type: "intake_failed", event_status: "failed", details: { submission_id: submissionId }, error: message });
    console.error("Korra intake failed", message);
    return json({ error: "Unable to process this request safely", retryable: true }, 500);
  }
});

async function generateDraft(requestText: string, name: string, business: string) {
  const urgentWords = /\b(urgent|emergency|immediately|asap|today|lost customer|not responding)\b/i;
  const urgency = urgentWords.test(requestText) ? "high" : "normal";
  return { output: { urgency, summary: requestText.slice(0, 500), missing_information: [], suggested_reply: `Hi ${name}, thank you for sharing the workflow issue at ${business}. We captured your request and prepared it for review. A person will review the proposed next step before anything is sent or changed.`, generation_source: "private_rules_engine" }, error: null };
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nextStep() {
  return "Check your email for testing instructions. Your request is queued for review, and nothing will be sent or changed without approval.";
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
