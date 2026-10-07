const REQUIRED_FIELDS = {
  attention: ['title', 'observedAt'],
  lead: ['name', 'stage', 'observedAt'],
  approval: ['state', 'observedAt'],
};

const KNOWN_APPROVAL_STATES = new Set(['pending', 'approved', 'rejected']);

function errorResult(code) {
  return {
    status: 'error', error: { code }, accountId: null, asOf: null,
    attentionItems: [], leads: [], approvals: [], excludedForeignCount: 0,
    ignoredRecordIds: [], executedActions: [],
  };
}

function valueOrNull(record, field) {
  const value = record[field];
  return value === undefined || value === null || value === '' ? null : value;
}

export function buildProfileContext(input = {}) {
  const { accountId, asOf } = input;
  if (typeof accountId !== 'string' || accountId === '') return errorResult('MISSING_ACCOUNT_ID');
  const asOfMs = typeof asOf === 'string' ? Date.parse(asOf) : NaN;
  if (Number.isNaN(asOfMs)) return errorResult('MISSING_AS_OF');

  const cutoff = asOfMs - (input.staleAfterHours ?? 168) * 60 * 60 * 1000;
  const output = {
    status: 'ok', error: null, accountId, asOf,
    attentionItems: [], leads: [], approvals: [], excludedForeignCount: 0,
    ignoredRecordIds: [], executedActions: [],
  };

  for (const record of input.records ?? []) {
    if (!record || record.accountId !== accountId) {
      output.excludedForeignCount += 1;
      continue;
    }
    const required = REQUIRED_FIELDS[record.type];
    if (!required) {
      output.ignoredRecordIds.push(record.id);
      continue;
    }
    const unknownFields = required.filter((field) => valueOrNull(record, field) === null);
    const observedAtValue = valueOrNull(record, 'observedAt');
    const observedAt = observedAtValue !== null && !Number.isNaN(Date.parse(observedAtValue))
      ? observedAtValue
      : null;
    if (observedAt === null && !unknownFields.includes('observedAt')) {
      unknownFields.push('observedAt');
    }
    const base = {
      sourceId: record.id,
      observedAt,
      stale: observedAt === null ? null : Date.parse(observedAt) < cutoff,
    };

    if (record.type === 'attention') {
      output.attentionItems.push({ ...base, kind: valueOrNull(record, 'kind'), title: valueOrNull(record, 'title'), unknownFields });
    } else if (record.type === 'lead') {
      output.leads.push({ ...base, name: valueOrNull(record, 'name'), stage: valueOrNull(record, 'stage'), unknownFields });
    } else {
      let state = valueOrNull(record, 'state');
      if (!KNOWN_APPROVAL_STATES.has(state)) {
        state = 'unknown';
        if (!unknownFields.includes('state')) unknownFields.unshift('state');
      } else if (state === 'pending' && valueOrNull(record, 'expiresAt') && Date.parse(record.expiresAt) < asOfMs) {
        state = 'expired';
      }
      output.approvals.push({
        ...base, state, requestedAction: valueOrNull(record, 'requestedAction'),
        expiresAt: valueOrNull(record, 'expiresAt'), unknownFields,
      });
    }
  }
  output.ignoredRecordIds.sort();
  return output;
}
