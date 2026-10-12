// Synthetic reference only. Callers must supply trusted identity and verification.
export function receive(state, event, context) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id.trim() || event.id.length > 128 || (event.text !== undefined && typeof event.text !== 'string')) return {state, outcome:'invalid_event'};
  if (!context?.authenticated || context.scope !== event.scope) return {state, outcome:'denied'};
  if (state.seen.includes(event.id)) return {state, outcome:'duplicate'};
  const next = {...state, seen:[...state.seen,event.id]};
  if (event.text?.trim().toUpperCase() === 'STOP') return {state:{...next, stopped:true},outcome:'stopped'};
  if (state.stopped) return {state:next,outcome:'stopped'};
  if (!Number.isFinite(context.remaining) || context.remaining <= 0) return {state:next,outcome:'budget_blocked'};
  if (event.type === 'audio') {
    if (!['audio/mpeg','audio/ogg'].includes(event.mime) || !Number.isFinite(event.seconds) || event.seconds <= 0 || event.seconds > 60) return {state:next,outcome:'unsupported_media'};
    if (!event.transcript || event.confirmed !== true) return {state:next,outcome:'clarify'};
  } else if (event.type !== 'text' || !event.text?.trim()) return {state:next,outcome:'clarify'};
  // Transcribed or typed approval words never authorize execution here.
  return {state:{...next,request:{id:event.id,status:'awaiting_approval',reply:context.voicePreferred?'audio_and_text':'text'}},outcome:'prepared'};
}
export function transition(request, event, context) {
  if (!context.authenticated || !context.sameScope) return request;
  if (['completed','rejected','expired'].includes(request.status)) return request;
  if (event.type === 'approve' && request.status === 'awaiting_approval') {
    if (!Number.isFinite(context.now) || !Number.isFinite(request.expiresAt) || context.now >= request.expiresAt) return {...request,status:'expired'};
    if (context.decisionVerified !== true || context.remaining <= 0 || !Number.isFinite(context.remaining)) return request;
    return {...request,status:'approved'};
  }
  if (event.type === 'dispatch' && request.status === 'approved') return {...request,status:'in_flight'};
  if (event.type === 'uncertain' && request.status === 'in_flight') return {...request,status:'unknown'};
  if (event.type === 'receipt' && ['in_flight','unknown'].includes(request.status) && context.receiptVerified === true && event.requestId === request.id && event.receipt) return {...request,status:'completed',receipt:event.receipt};
  // Retry cannot dispatch unknown results. Resolve by verified lookup receipt.
  return request;
}
