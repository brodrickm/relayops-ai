const MAX_BODY_BYTES = 16_384;
const crypto = require('crypto');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return response.status(413).json({ ok: false, message: 'Request is too large.' });
  }

  const body = request.body || {};
  if (String(body.company_website || '').trim()) {
    return response.status(202).json({ ok: true });
  }

  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const payload = {
    full_name: clean(body.full_name, 120),
    business: clean(body.business, 160),
    email: clean(body.email, 254),
    phone: clean(body.phone, 40),
    workflow_bottleneck: clean(body.workflow_bottleneck, 2000),
    monthly_inquiry_volume: clean(body.monthly_inquiry_volume, 80),
    idempotency_key: clean(body.idempotency_key, 120),
  };

  if (!payload.full_name || !payload.email || !payload.workflow_bottleneck) {
    return response.status(400).json({ ok: false, message: 'Name, email, and workflow details are required.' });
  }

  const webhookUrl = process.env.KORRA_N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return response.status(503).json({ ok: false, message: 'Intake is temporarily unavailable.' });
  }

  try {
    const idempotencyKey = payload.idempotency_key || crypto
      .createHash('sha256')
      .update(`${payload.email.toLowerCase()}|${payload.workflow_bottleneck}|${payload.business}|${new Date().toISOString().slice(0, 10)}`)
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
    const receipt = await upstream.json().catch(() => ({}));

    return response.status(202).json({
      ok: true,
      status: 'approval_required',
      message: 'Your request is queued for review. Nothing was sent externally.',
      lead_id: receipt.lead_id || null,
      action_id: receipt.action_id || null,
      submission_id: receipt.submission_id || null,
      duplicate: Boolean(receipt.duplicate),
      next_step: receipt.next_step || 'Check your email for testing instructions and reply with feedback after testing.',
      delivery: receipt.receipt || { acknowledgment: 'queued', approval: 'queued', sms: 'skipped' },
    });
  } catch (error) {
    console.error('Korra intake relay failed', error instanceof Error ? error.message : 'Unknown error');
    return response.status(502).json({ ok: false, message: 'Unable to queue this request.' });
  }
};

