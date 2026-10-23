/** Read-only compatibility identities derived from accepted package and engine state. */
import {
  DATA_LIMITS,
  DEFINITION_LIMITS,
  FORMULA_LIMITS,
  KEYWORD_LIMITS,
  compileForm,
  formulaJsRegistrySummary
} from "@dcms/form-rules";
import { freezeOwnedGraph } from "./immutable.js";
import {
  DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
  DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
  DCMS_WORKBENCH_PACKAGE_KIND,
  DCMS_WORKBENCH_PACKAGE_MAX_BYTES,
  DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION
} from "./workbench-package-contracts.js";
import type { WorkbenchRevisionSessionAuthorityV2 } from "./workbench-revision-session.js";

export const WORKBENCH_EXTERNAL_INTEGRITY_POLICY_V2 = Object.freeze({
  serialization: "deterministic-json" as const,
  digestAlgorithm: "SHA-256" as const,
  digestPlacement: "external-sidecar" as const,
  embeddedDigest: false as const
});

export interface WorkbenchCompatibilityIdentityV2 {
  readonly nodeId: string;
  readonly title: string;
  readonly packageContract: {
    readonly kind: typeof DCMS_WORKBENCH_PACKAGE_KIND;
    readonly schemaVersion: typeof DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION;
  };
  readonly form: {
    readonly modelSchemaVersion: 1;
    readonly formId: string;
    readonly formVersion: string | number;
    readonly definitionFingerprint: string;
    readonly definitionSourceHash: string;
    readonly compiledPlanKey: string;
  };
  readonly engine: {
    readonly compilerVersion: string;
    readonly formulaLanguageVersion: string;
    readonly requiredKeywordsLanguageVersion: string;
    readonly registryVersion: string;
    readonly registryFingerprint: string;
    readonly formulaJsVersion: string;
    readonly limitsVersion: string;
  };
  readonly registry: {
    readonly total: number;
    readonly counts: Readonly<Record<string, number>>;
  };
  readonly limits: {
    readonly packageMaxBytes: number;
    readonly completeRevisionMaxForms: number;
    readonly descriptionMaxCharacters: number;
    readonly definition: typeof DEFINITION_LIMITS;
    readonly formula: typeof FORMULA_LIMITS;
    readonly requiredKeywords: typeof KEYWORD_LIMITS;
    readonly data: typeof DATA_LIMITS;
  };
  readonly integrity: typeof WORKBENCH_EXTERNAL_INTEGRITY_POLICY_V2;
}

/** Build a compatibility view from one accepted authority; no telemetry is invented. */
export function createWorkbenchCompatibilityIdentityV2(
  authority: WorkbenchRevisionSessionAuthorityV2,
  nodeId = authority.storeSnapshot.activeNodeId ??
    authority.storeSnapshot.forms[0]?.nodeId
): WorkbenchCompatibilityIdentityV2 {
  if (!nodeId) throw new Error("The accepted Workbench has no Form identity.");
  const form = authority.storeSnapshot.forms.find(
    (candidate) => candidate.nodeId === nodeId
  );
  const model = authority.managerSnapshot.session.modelByNode[nodeId];
  if (!form || !model) {
    throw new Error(`Unknown accepted Workbench Form node: ${nodeId}.`);
  }
  const plan = compileForm(form.definition);
  const registry = formulaJsRegistrySummary();

  return freezeOwnedGraph({
    nodeId,
    title: form.title,
    packageContract: {
      kind: DCMS_WORKBENCH_PACKAGE_KIND,
      schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION
    },
    form: {
      modelSchemaVersion: model.schemaVersion,
      formId: plan.formId,
      formVersion: plan.version,
      definitionFingerprint: form.definitionFingerprint,
      definitionSourceHash: plan.sourceHash,
      compiledPlanKey: plan.key
    },
    engine: {
      compilerVersion: plan.compilerVersion,
      formulaLanguageVersion: plan.languageVersion,
      requiredKeywordsLanguageVersion: plan.keywordLanguageVersion,
      registryVersion: plan.registryVersion,
      registryFingerprint: plan.registryFingerprint,
      formulaJsVersion: plan.formulaJsVersion,
      limitsVersion: plan.limitsVersion
    },
    registry: {
      total: registry.total,
      counts: registry.counts
    },
    limits: {
      packageMaxBytes: DCMS_WORKBENCH_PACKAGE_MAX_BYTES,
      completeRevisionMaxForms: DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
      descriptionMaxCharacters: DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      definition: DEFINITION_LIMITS,
      formula: FORMULA_LIMITS,
      requiredKeywords: KEYWORD_LIMITS,
      data: DATA_LIMITS
    },
    integrity: WORKBENCH_EXTERNAL_INTEGRITY_POLICY_V2
  });
}
