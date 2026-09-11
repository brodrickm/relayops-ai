import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return page("This feedback link is invalid.", 400);
  const hash = await sha256(token);
  const { data: submission } = await supabase.from("intake_submissions").select("*,testers(*)").eq("feedback_token_hash", hash).maybeSingle();
  if (!submission) return page("This feedback link is invalid.", 404);
  if (!submission.feedback_expires_at || new Date(submission.feedback_expires_at).getTime() <= Date.now()) return page("This feedback link has expired.", 410);
  if (req.method === "GET") return formPage(token, submission.testers?.full_name || "tester");
  if (req.method !== "POST") return page("Method not allowed.", 405);
  const form = await req.formData();
  const rating = Number(form.get("rating") || 0);
  const raw = { easy: clean(form.get("easy"), 2000), confusing: clean(form.get("confusing"), 2000), failed: clean(form.get("failed"), 2000), expected_next: clean(form.get("expected_next"), 2000), rating: rating >= 1 && rating <= 5 ? rating : null };
  if (!raw.easy && !raw.confusing && !raw.failed && !raw.expected_next && !raw.rating) return page("Please share at least one piece of feedback.", 400);
  const key = `feedback:${submission.id}`;
  const saved = await supabase.from("tester_feedback").upsert({ organization_id: submission.organization_id, tester_id: submission.tester_id, intake_submission_id: submission.id, idempotency_key: key, easy_text: raw.easy || null, confusing_text: raw.confusing || null, failed_text: raw.failed || null, expected_next: raw.expected_next || null, rating: raw.rating, raw_feedback: raw }, { onConflict: "idempotency_key" }).select().single();
  if (saved.error) return page("We could not save your feedback. Please try again.", 500);
  await supabase.from("testers").update({ lifecycle_status: "feedback_received", followup_status: "cancelled", last_feedback_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", submission.tester_id);
  await supabase.from("outbound_messages").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("idempotency_key", `tester_followup:${submission.id}`).in("status", ["queued", "retrying"]);
  await supabase.from("lifecycle_events").upsert({ organization_id: submission.organization_id, tester_id: submission.tester_id, lead_id: submission.lead_id, event_type: "tester_feedback_received", idempotency_key: key, details: { feedback_id: saved.data.id, rating: raw.rating } }, { onConflict: "idempotency_key" });
  return page("Thank you. Your Korra feedback was received.", 200);
});

function formPage(token: string, name: string) { const safe = escapeHtml(token); return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Korra feedback</title><style>${styles()}</style></head><body><main><h1>Tell us how Korra worked</h1><p>Hi ${escapeHtml(name)}, your feedback helps us finish the product.</p><form method="post" action="?token=${safe}"><label>What was easy?<textarea name="easy" maxlength="2000"></textarea></label><label>What was confusing?<textarea name="confusing" maxlength="2000"></textarea></label><label>What did not work?<textarea name="failed" maxlength="2000"></textarea></label><label>What did you expect Korra to do next?<textarea name="expected_next" maxlength="2000"></textarea></label><label>Overall rating<select name="rating"><option value="">Choose</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label><button>Send feedback</button></form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
function page(message: string, status: number) { return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Korra</title><style>${styles()}</style></head><body><main><h1>Korra</h1><p>${escapeHtml(message)}</p></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
function styles() { return "body{margin:0;background:#fafaf8;color:#0f172a;font:16px/1.6 Arial,sans-serif}main{max-width:680px;margin:40px auto;padding:30px;background:#fff;border:1px solid #e2e8f0;border-radius:18px}label{display:block;margin:18px 0;font-weight:700}textarea,select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}textarea{min-height:90px}button{padding:14px 22px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700}"; }
function clean(value: FormDataEntryValue | null, max: number) { return String(value || "").trim().slice(0, max); }
function escapeHtml(value: unknown) { return String(value || "").replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

