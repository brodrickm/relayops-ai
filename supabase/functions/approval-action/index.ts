import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return page("This approval link is invalid.", 400);
  const hash = await sha256(token);
  const { data: approval } = await supabase.from("approval_requests").select("*,agent_actions(id,lead_id,action_type,status,risk,output,leads(full_name,email,request))").eq("token_hash", hash).maybeSingle();
  if (!approval) return page("This approval link is invalid.", 404);
  if (approval.decision !== "pending") return page(`This request was already ${escapeHtml(approval.decision)}.`, 200);
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    await supabase.from("approval_requests").update({ decision: "expired", updated_at: new Date().toISOString() }).eq("id", approval.id).eq("decision", "pending");
    return page("This approval link has expired. Request a new link from the Korra operator.", 410);
  }

  if (req.method === "GET") {
    const action = approval.agent_actions as any;
    const lead = action?.leads || {};
    const summary = action?.output?.summary || lead.request || "Prepared action";
    return approvalPage(token, lead.full_name || lead.email || "this request", summary, action?.output?.suggested_reply || "");
  }
  if (req.method !== "POST") return page("Method not allowed.", 405);

  const form = await req.formData();
  const decision = String(form.get("decision") || "");
  if (!['approved','rejected'].includes(decision)) return page("Choose approve or reject.", 400);
  const decidedAt = new Date().toISOString();
  const updated = await supabase.from("approval_requests").update({ decision, decided_at: decidedAt, decision_source: "secure_link", updated_at: decidedAt }).eq("id", approval.id).eq("decision", "pending").select().maybeSingle();
  if (updated.error) return page("We could not record the decision. Please try again.", 500);
  if (!updated.data) return page("This request was already decided.", 409);

  const actionStatus = decision === "approved" ? "approved" : "rejected";
  await supabase.from("agent_actions").update({ status: actionStatus, approved_at: decision === "approved" ? decidedAt : null }).eq("id", approval.action_id).eq("status", "proposed");
  await supabase.from("lifecycle_events").insert({ organization_id: approval.organization_id, lead_id: (approval.agent_actions as any)?.lead_id || null, action_id: approval.action_id, event_type: `action_${decision}`, event_status: "recorded", idempotency_key: `approval_decision:${approval.id}`, details: { source: "secure_link" } });
  const { data: settings } = await supabase.from("organization_settings").select("owner_email").eq("organization_id", approval.organization_id).single();
  if (settings?.owner_email) await supabase.from("outbound_messages").upsert({ organization_id: approval.organization_id, action_id: approval.action_id, channel: "email", message_kind: "approval_result", recipient: settings.owner_email, idempotency_key: `approval_result:${approval.id}`, status: "queued", payload: { decision, action_id: approval.action_id } }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  return page(decision === "approved" ? "Approved. Korra may now continue this specific action." : "Rejected. Korra will not run this action.", 200);
});

function approvalPage(token: string, name: string, summary: string, reply: string) {
  const safeToken = escapeHtml(token);
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Korra approval</title><style>${styles()}</style></head><body><main><h1>Approval required</h1><p><strong>${escapeHtml(name)}</strong></p><p>${escapeHtml(summary)}</p>${reply ? `<h2>Prepared reply</h2><p>${escapeHtml(reply)}</p>` : ""}<p class="safety">Nothing runs until you approve this specific action.</p><div class="actions"><form method="post" action="?token=${safeToken}"><input type="hidden" name="decision" value="approved"><button class="approve">Approve</button></form><form method="post" action="?token=${safeToken}"><input type="hidden" name="decision" value="rejected"><button class="reject">Reject</button></form></div></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" } });
}

function page(message: string, status: number) { return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Korra</title><style>${styles()}</style></head><body><main><h1>Korra</h1><p>${escapeHtml(message)}</p></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
function styles() { return "body{margin:0;background:#fafaf8;color:#0f172a;font:16px/1.6 Arial,sans-serif}main{max-width:680px;margin:60px auto;padding:30px;background:#fff;border:1px solid #e2e8f0;border-radius:18px}h1{font-size:32px}h2{font-size:20px}.safety{padding:14px;background:#f8fafc;border-left:4px solid #6366f1}.actions{display:flex;gap:12px;margin-top:24px}.actions form{flex:1}button{width:100%;padding:14px;border:0;border-radius:10px;color:#fff;font-weight:700;cursor:pointer}.approve{background:#2563eb}.reject{background:#475569}"; }
function escapeHtml(value: unknown) { return String(value || "").replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
