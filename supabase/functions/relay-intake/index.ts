import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-relayops-secret",
};

type Intake = {
  organization_id: string;
  source?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  request: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("RELAYOPS_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-relayops-secret") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = (await req.json()) as Intake;
    if (!body.organization_id || !body.request?.trim()) {
      return json({ error: "organization_id and request are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: lead, error: leadError } = await supabase.from("leads").insert({
      organization_id: body.organization_id,
      source: body.source || "webhook",
      full_name: body.full_name || null,
      email: body.email || null,
      phone: body.phone || null,
      request: body.request.trim(),
    }).select().single();
    if (leadError) throw leadError;

    const system = `You are RelayOps Intake. Return strict JSON with urgency (low|normal|high), summary, missing_information (array), and suggested_reply. Never promise outcomes, prices, or appointment availability. Do not include sensitive information not present in the request.`;
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [{ role: "system", content: system }, { role: "user", content: body.request }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!aiResponse.ok) throw new Error(`OpenAI request failed: ${aiResponse.status}`);
    const result = await aiResponse.json();
    const raw = result.output_text || "{}";
    const analysis = JSON.parse(raw);

    const { data: action, error: actionError } = await supabase.from("agent_actions").insert({
      organization_id: body.organization_id,
      lead_id: lead.id,
      action_type: "draft_lead_reply",
      risk: "approval_required",
      status: "proposed",
      input: { request: body.request },
      output: analysis,
    }).select().single();
    if (actionError) throw actionError;

    await supabase.from("leads").update({
      urgency: analysis.urgency || "normal",
      status: "awaiting_approval",
      updated_at: new Date().toISOString(),
    }).eq("id", lead.id);

    return json({ lead_id: lead.id, action_id: action.id, status: "awaiting_approval" }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

