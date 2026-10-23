/** Definition-bound Draft payload helpers shared by host integrations. */
import {
  getCompiledPlanCacheKey,
  type DcmsValue,
  type FormDefinition
} from "@dcms/form-rules";
import type { DraftEnvelope } from "./contracts.js";

function cloneDraftValue(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? value.map(cloneDraftValue) : value;
}

/** Bind source values to the exact Form content that produced the Draft. */
export function createDraftEnvelope(
  definition: FormDefinition,
  values: ReadonlyMap<string, DcmsValue>
): DraftEnvelope {
  return {
    schemaVersion: 1,
    formId: definition.formId,
    formVersion: definition.version,
    definitionFingerprint: getCompiledPlanCacheKey(definition),
    values: Object.fromEntries(
      [...values].map(([fieldId, value]) => [fieldId, cloneDraftValue(value)])
    )
  };
}

/** Reject Draft reuse when Form identity, version, or content fingerprint drifts. */
export function draftMatchesDefinition(
  draft: DraftEnvelope,
  definition: FormDefinition
): boolean {
  return (
    draft.schemaVersion === 1 &&
    draft.formId === definition.formId &&
    draft.formVersion === definition.version &&
    draft.definitionFingerprint === getCompiledPlanCacheKey(definition)
  );
}
