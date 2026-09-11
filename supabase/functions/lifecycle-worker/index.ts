import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const expected = Deno.env.get("RELAYOPS_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-relayops-secret") !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  await supabase
    .from("outbound_messages")
    .update({ status: "failed", next_retry_at: nowIso, last_error: "Delivery claim expired before completion", updated_at: nowIso })
    .eq("status", "sending")
    .lt("updated_at", staleBefore);

  const { data, error } = await supabase
    .from("outbound_messages")
    .select("*")
    .in("status", ["queued", "failed", "retrying"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const due = (data || [])
    .filter((message) => Number(message.attempt_count || 0) < Number(message.max_attempts || 3))
    .filter((message) => !message.next_retry_at || new Date(message.next_retry_at).getTime() <= now.getTime())
    .slice(0, 25);
  const ids = due.map((message) => message.id);

  if (ids.length) {
    const claimed = await supabase
      .from("outbound_messages")
      .update({ status: "sending", updated_at: nowIso })
      .in("id", ids)
      .in("status", ["queued", "failed", "retrying"]);
    if (claimed.error) return Response.json({ error: claimed.error.message }, { status: 500 });
  }

  return Response.json({ messages: due, claimed: ids.length }, { headers: { "Cache-Control": "no-store" } });
});
