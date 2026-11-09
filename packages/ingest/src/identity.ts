import type { FlowObject, EvidenceRef, Materiality } from '@fulcrum/schema';
import type { EntityResolution } from '@fulcrum/context/interfaces';
import type { CommandInvocation } from '@fulcrum/schema';
const MIN_CHOICES = 2;
const MAX_CHOICES = 3;
const MAX_LABEL_LENGTH = 120;
const MAX_MENTION_LENGTH = 120;
export interface IdentityQuestionInput {
  id: string; resolution: EntityResolution; dependency: FlowObject;
  evidenceRefs: EvidenceRef[]; materiality: Materiality | 'low';
}
export function identityQuestion(input: IdentityQuestionInput): CommandInvocation | null {
  const { resolution, dependency } = input;
  if (dependency.type !== 'dependency' || input.materiality === 'low' || !input.evidenceRefs.length || resolution.status !== 'ambiguous') return null;
  if (resolution.candidates.length < MIN_CHOICES || resolution.candidates.length > MAX_CHOICES) return null;
  const dedupeKey = `identity:node:${dependency.id}:responsibleEntityId`;
  return { name: 'question.raise', args: { record: {
    id: input.id, initiativeId: dependency.initiativeId, target: { kind: 'node', id: dependency.id }, reason: 'identity_ambiguity',
    prompt: `Who does “${resolution.mention.text.slice(0, MAX_MENTION_LENGTH)}” refer to for this dependency?`,
    evidenceRefs: input.evidenceRefs, materiality: input.materiality, dedupeKey,
    resolutions: resolution.candidates.map(entity => ({ id: entity.id, label: entity.label.slice(0, MAX_LABEL_LENGTH),
      commands: [{ name: 'node.update', args: { id: dependency.id, patch: { responsibleEntityId: entity.id } } }] })),
  } } };
}
