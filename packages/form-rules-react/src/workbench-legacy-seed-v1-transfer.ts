/**
 * Explicit application boundary for Original Workbench seed-v1 interchange.
 *
 * The legacy transport remains distinct from strict package v2. Import first
 * parses and prepares a complete candidate off-screen, then reuses the same
 * authority-bound replacement policy as native complete-Revision v2 import.
 */
import type { DcmsValue } from "@dcms/form-rules";
import {
  convertCompleteRevisionV2ToLegacyWorkbenchSeedV1,
  convertLegacyWorkbenchSeedV1ToCompleteRevisionV2,
  parseLegacyWorkbenchSeedV1,
  serializeLegacyWorkbenchSeedV1,
  type LegacyWorkbenchSeedV1,
  type LegacyWorkbenchSeedV1ExportOptions
} from "./workbench-package-codec.js";
import { prepareCompleteRevisionPackageV2 } from "./workbench-package-preparation.js";
import { createCompleteRevisionPackageV2FromAuthority } from "./workbench-package-transfer.js";
import {
  confirmWorkbenchCompleteRevisionReplacementV2,
  createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2,
  type WorkbenchCompleteRevisionReplacementPolicyResultV2,
  type WorkbenchCompleteRevisionReplacementProposalV2,
  type WorkbenchCompleteRevisionReplacementSummaryV2
} from "./workbench-revision-replacement-policy.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionConstructionOptionsV2,
  WorkbenchRevisionSessionManagerV2
} from "./workbench-revision-session.js";

export const ORIGINAL_WORKBENCH_SEED_V1_FORMAT =
  "Original Workbench seed v1" as const;

export interface OriginalWorkbenchSeedV1Export {
  readonly format: typeof ORIGINAL_WORKBENCH_SEED_V1_FORMAT;
  readonly scope: "complete-revision";
  readonly filename: string;
  readonly packageData: LegacyWorkbenchSeedV1;
  readonly text: string;
}

export interface OriginalWorkbenchSeedV1ImportSummary {
  readonly format: typeof ORIGINAL_WORKBENCH_SEED_V1_FORMAT;
  readonly schemaVersion: 1;
  readonly scope: "complete-revision";
  readonly prototypeVersion?: string;
  readonly exportedAt?: string;
  readonly productId: string;
  readonly revisionId: string;
  readonly revisionLabel: string;
  readonly documentId: string;
  readonly seed: string;
  readonly profile: string;
  readonly formCount: number;
  readonly fieldCount: number;
  readonly validationRowCount: number;
  readonly documentDescriptionCount: number;
  readonly recordDescriptionCount: number;
  readonly unitFieldCount: number;
  readonly atlasFieldCount: number;
  readonly typedMetadataFieldCount: number;
  readonly firstActiveNodeId: string;
  readonly firstActiveFormTitle: string;
  readonly replacement: WorkbenchCompleteRevisionReplacementSummaryV2;
}

export interface OriginalWorkbenchSeedV1ImportProposal {
  readonly source: LegacyWorkbenchSeedV1;
  readonly replacement: WorkbenchCompleteRevisionReplacementProposalV2;
  /** Non-portable seed fixtures carried by legacy uiFields[].value. */
  readonly seedValuesByNode: Readonly<
    Record<string, Readonly<Record<string, DcmsValue>>>
  >;
  readonly summary: OriginalWorkbenchSeedV1ImportSummary;
}

function safeFilenameSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized || "revision";
}

/** Stable compatibility filename; equal Revision identity yields equal name. */
export function originalWorkbenchSeedFilenameV1(revisionId: string): string {
  return `dcms-${safeFilenameSegment(revisionId)}-original-workbench-seed-v1.json`;
}

function clonedValue(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? structuredClone(value) : value;
}

/** Export one coherent accepted authority through the explicit legacy codec. */
export function createOriginalWorkbenchSeedV1Export(
  authority: WorkbenchRevisionSessionAuthorityV2,
  options: LegacyWorkbenchSeedV1ExportOptions = {}
): OriginalWorkbenchSeedV1Export {
  const completeRevision =
    createCompleteRevisionPackageV2FromAuthority(authority);
  const candidate = convertCompleteRevisionV2ToLegacyWorkbenchSeedV1(
    completeRevision,
    options
  );

  // Original v0.10.5 stored its reusable fixture in uiFields[].value,
  // separately from current and Original Record maps. Native package v2 does
  // not carry that non-portable fixture, but the accepted session does.
  for (const node of candidate.revision.nodes) {
    const sessionForm =
      authority.managerSnapshot.session.formByNode[node.nodeId];
    if (!sessionForm) {
      throw new Error(
        `Accepted Workbench session is missing legacy seed Form ${node.nodeId}.`
      );
    }
    for (const field of node.uiFields) {
      if (!sessionForm.seedValues.has(field.id)) {
        throw new Error(
          `Accepted Workbench seed fixture is missing field ${field.id}.`
        );
      }
      field.value = clonedValue(sessionForm.seedValues.get(field.id)!);
    }
  }

  const text = serializeLegacyWorkbenchSeedV1(candidate);
  const packageData = parseLegacyWorkbenchSeedV1(text);
  return Object.freeze({
    format: ORIGINAL_WORKBENCH_SEED_V1_FORMAT,
    scope: "complete-revision" as const,
    filename: originalWorkbenchSeedFilenameV1(
      authority.managerSnapshot.session.revision.revisionId
    ),
    packageData,
    text
  });
}

function importSummary(
  source: LegacyWorkbenchSeedV1,
  replacement: WorkbenchCompleteRevisionReplacementProposalV2
): OriginalWorkbenchSeedV1ImportSummary {
  const fields = source.revision.nodes.flatMap((node) => node.uiFields);
  const first = source.revision.nodes[0];
  return Object.freeze({
    format: ORIGINAL_WORKBENCH_SEED_V1_FORMAT,
    schemaVersion: 1 as const,
    scope: "complete-revision" as const,
    ...(source.prototypeVersion === undefined
      ? {}
      : { prototypeVersion: source.prototypeVersion }),
    ...(source.exportedAt === undefined
      ? {}
      : { exportedAt: source.exportedAt }),
    productId: source.revision.productId,
    revisionId: source.revision.revisionId,
    revisionLabel: source.revision.revisionLabel,
    documentId: source.revision.documentId,
    seed: source.revision.seed,
    profile: source.revision.profile,
    formCount: source.revision.nodes.length,
    fieldCount: fields.length,
    validationRowCount: fields.reduce(
      (count, field) => count + field.validationRows.length,
      0
    ),
    documentDescriptionCount: source.revision.nodes.filter(
      (node) => node.docDescription.length > 0
    ).length,
    recordDescriptionCount: source.revision.nodes.filter(
      (node) => node.recordDescription.length > 0
    ).length,
    unitFieldCount: fields.filter((field) => field.unit !== undefined).length,
    atlasFieldCount: fields.filter((field) => field.atlasId !== undefined)
      .length,
    typedMetadataFieldCount: fields.filter(
      (field) => field.unit !== undefined || field.atlasId !== undefined
    ).length,
    firstActiveNodeId: first.nodeId,
    firstActiveFormTitle: first.title,
    replacement: replacement.summary
  });
}

function legacySeedValues(
  source: LegacyWorkbenchSeedV1
): Readonly<Record<string, Readonly<Record<string, DcmsValue>>>> {
  return Object.freeze(
    Object.fromEntries(
      source.revision.nodes.map((node) => [
        node.nodeId,
        Object.freeze(
          Object.fromEntries(
            node.uiFields.map((field) => [
              field.id,
              clonedValue(
                field.value === undefined
                  ? node.recordValues[field.id]
                  : field.value
              )
            ])
          )
        )
      ])
    )
  );
}

function seedValueMaps(
  values: OriginalWorkbenchSeedV1ImportProposal["seedValuesByNode"]
): ReadonlyMap<string, ReadonlyMap<string, DcmsValue>> {
  return new Map(
    Object.entries(values).map(([nodeId, fields]) => [
      nodeId,
      new Map(
        Object.entries(fields).map(([fieldId, value]) => [
          fieldId,
          clonedValue(value)
        ])
      )
    ])
  );
}

/**
 * Parse and prepare an Original Workbench seed-v1 file without publication.
 * Authority is captured before parsing so any concurrent accepted-state change
 * invalidates later confirmation.
 */
export function createOriginalWorkbenchSeedV1ImportProposal(
  manager: WorkbenchRevisionSessionManagerV2,
  text: string
): OriginalWorkbenchSeedV1ImportProposal {
  const authority = manager.captureAuthority();
  const source = parseLegacyWorkbenchSeedV1(text);
  const completeRevision =
    convertLegacyWorkbenchSeedV1ToCompleteRevisionV2(source);
  const prepared = prepareCompleteRevisionPackageV2(completeRevision);
  const replacement =
    createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2(
      authority,
      prepared
    );
  return Object.freeze({
    source,
    replacement,
    seedValuesByNode: legacySeedValues(source),
    summary: importSummary(source, replacement)
  });
}

/** Confirm one previously reviewed compatibility import through atomic replacement. */
export function confirmOriginalWorkbenchSeedV1Import(
  manager: WorkbenchRevisionSessionManagerV2,
  proposal: OriginalWorkbenchSeedV1ImportProposal,
  options: {
    readonly confirmDiscardUnsaved: boolean;
    readonly sessionOptions?: WorkbenchRevisionSessionConstructionOptionsV2;
  }
): WorkbenchCompleteRevisionReplacementPolicyResultV2 {
  return confirmWorkbenchCompleteRevisionReplacementV2(
    manager,
    proposal.replacement,
    {
      confirmDiscardUnsaved: options.confirmDiscardUnsaved,
      sessionOptions: {
        ...options.sessionOptions,
        seedValuesByNode: seedValueMaps(proposal.seedValuesByNode)
      }
    }
  );
}
