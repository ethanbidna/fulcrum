
const STRING = { type: 'string', minLength: 1 };
const FIELDS = {
  user_commitment: { text: STRING, dueHint: STRING },
  external_commitment: { who: STRING, text: STRING },
  state_change: { targetHint: STRING, newState: STRING },
  decision_made: { targetHint: STRING, optionHint: STRING },
  priority_opinion: { targetHint: STRING, value: STRING, who: STRING },
  new_initiative: { title: STRING, rationale: STRING },
  date: { targetHint: STRING, date: STRING },
  relationship: { fromHint: STRING, toHint: STRING, type: { enum: ['depends_on', 'leads_to'] } },
};
const SPAN = {
  type: 'object', additionalProperties: false, required: ['start', 'end'],
  properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } },
};
export const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: { candidates: { type: 'array', items: { oneOf: Object.entries(FIELDS).map(([kind, fields]) => ({
    type: 'object', additionalProperties: false,
    required: ['kind', 'span', ...Object.keys(fields).filter(key => key !== 'dueHint')],
    properties: { kind: { const: kind }, ...fields, span: SPAN },
  })) } } },
};
