import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const expected = Deno.env.get("RELAYOPS_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-relayops-secret") !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date().toISOString();
  await supabase.from("outbound_messages").update({ status: "retrying", next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), updated_at: now }).eq("status", "failed").lt("attempt_count", 3).or(`next_retry_at.is.null,next_retry_at.lte.${now}`);
  const { data, error } = await supabase.from("outbound_messages").select("*").in("status", ["queued", "retrying"]).or(`next_retry_at.is.null,next_retry_at.lte.${now}`).order("created_at", { ascending: true }).limit(25);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const ids = (data || []).map((message) => message.id);
  if (ids.length) await supabase.from("outbound_messages").update({ status: "sending", updated_at: now }).in("id", ids).in("status", ["queued", "retrying"]);
  return Response.json({ messages: data || [], claimed: ids.length }, { headers: { "Cache-Control": "no-store" } });
});

