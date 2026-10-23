/**
 * Headless application-session ownership for complete Workbench Revision replacement.
 *
 * A prepared complete-Revision candidate is converted into a brand-new Workbench
 * store plus its matching presentation models before one manager snapshot is
 * published. The previous store remains live until the React owner confirms that
 * the replacement snapshot has committed, then releases the retired session.
 */
import {
  getCompiledPlanCacheKey,
  type DcmsValue,
  type FormDefinition,
  type RecordEvaluation
} from "@dcms/form-rules";
import { cloneFrozenGraph } from "./immutable.js";
import {
  formDefinitionFromWorkbenchModel,
  type WorkbenchFormModel
} from "./workbench-model.js";
import type { DcmsCompleteRevisionMetadataV2 } from "./workbench-package-contracts.js";
import type {
  PreparedCompleteRevisionFormV2,
  PreparedCompleteRevisionPackageV2
} from "./workbench-package-preparation.js";
import {
  createWorkbenchStore,
  type WorkbenchFormSnapshot,
  type WorkbenchSnapshot,
  type WorkbenchStore
} from "./workbench-store.js";

export interface WorkbenchRevisionSessionFormV2 {
  readonly nodeId: string;
  readonly title: string;
  readonly scenario: string;
  readonly seed: string;
  readonly section: number;
  readonly step: number;
  readonly docDescription: string;
  readonly recordDescription: string;
  readonly model: WorkbenchFormModel;
  readonly seedValues: ReadonlyMap<string, DcmsValue>;
  readonly originalValues: ReadonlyMap<string, DcmsValue>;
}

/**
 * One coherent application session. The store owns accepted Form/Record state;
 * this object owns the matching Revision metadata and presentation models.
 */
export interface WorkbenchRevisionSessionV2 {
  readonly revision: DcmsCompleteRevisionMetadataV2;
  readonly forms: readonly WorkbenchRevisionSessionFormV2[];
  readonly formByNode: Readonly<Record<string, WorkbenchRevisionSessionFormV2>>;
  readonly modelByNode: Readonly<Record<string, WorkbenchFormModel>>;
  readonly store: WorkbenchStore;
}

/** Optional non-portable session fixtures retained across an in-app replacement. */
export interface WorkbenchRevisionSessionConstructionOptionsV2 {
  readonly seedValuesByNode?: ReadonlyMap<
    string,
    ReadonlyMap<string, DcmsValue>
  >;
  /** Preserve accepted Form authoring dirtiness across an atomic replacement. */
  readonly dirtyByNode?: ReadonlyMap<string, boolean>;
}

export interface WorkbenchRevisionSessionManagerSnapshotV2 {
  readonly version: number;
  readonly session: WorkbenchRevisionSessionV2;
}

/** Compare-and-swap authority captured before a package summary/confirmation step. */
export interface WorkbenchRevisionSessionAuthorityV2 {
  readonly managerSnapshot: WorkbenchRevisionSessionManagerSnapshotV2;
  readonly storeSnapshot: WorkbenchSnapshot;
}

export type WorkbenchRevisionSessionReplacementErrorCode =
  | "SESSION_AUTHORITY_STALE"
  | "SESSION_CANDIDATE_INVALID"
  | "SESSION_MANAGER_DISPOSED";

export type WorkbenchRevisionSessionReplacementResultV2 =
  | {
      readonly accepted: true;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly notificationErrors: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly code: WorkbenchRevisionSessionReplacementErrorCode;
      readonly error: string;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
    };

export interface WorkbenchRevisionSessionManagerV2 {
  subscribe(callback: () => void): () => void;
  getSnapshot(): WorkbenchRevisionSessionManagerSnapshotV2;
  captureAuthority(): WorkbenchRevisionSessionAuthorityV2;
  replacePreparedCompleteRevision(
    prepared: PreparedCompleteRevisionPackageV2,
    authority: WorkbenchRevisionSessionAuthorityV2,
    options?: WorkbenchRevisionSessionConstructionOptionsV2
  ): WorkbenchRevisionSessionReplacementResultV2;
  adoptAcceptedFormModel(nodeId: string, model: WorkbenchFormModel): void;
  releaseRetiredSessionsThrough(version: number): number;
  dispose(): void;
}

function readonlyRecord<T>(entries: readonly (readonly [string, T])[]) {
  const record = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value
    });
  }
  return Object.freeze(record) as Readonly<Record<string, T>>;
}

function sameDcmsValue(
  left: DcmsValue | undefined,
  right: DcmsValue | undefined
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => sameDcmsValue(value, right[index]))
    );
  }
  return Object.is(left, right);
}

function sameValueMap(
  left: ReadonlyMap<string, DcmsValue>,
  right: ReadonlyMap<string, DcmsValue>
) {
  if (left.size !== right.size) return false;
  for (const [fieldId, value] of left) {
    if (!right.has(fieldId) || !sameDcmsValue(value, right.get(fieldId))) {
      return false;
    }
  }
  return true;
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameEvaluation(
  left: RecordEvaluation | null,
  right: RecordEvaluation
) {
  return Boolean(
    left &&
      left.canSubmit === right.canSubmit &&
      sameIds(left.blockingFieldIds, right.blockingFieldIds) &&
      sameIds(left.warningFieldIds, right.warningFieldIds) &&
      sameIds(left.errorFieldIds, right.errorFieldIds)
  );
}

function assertFormSnapshotMatchesPrepared(
  snapshot: WorkbenchFormSnapshot,
  prepared: PreparedCompleteRevisionFormV2,
  index: number,
  expectedDirty: boolean
) {
  const path = `forms[${index}]`;
  if (snapshot.nodeId !== prepared.nodeId) {
    throw new Error(
      `${path} node identity changed during session construction.`
    );
  }
  if (snapshot.title !== prepared.title) {
    throw new Error(`${path} title changed during session construction.`);
  }
  if (snapshot.definitionFingerprint !== prepared.definitionFingerprint) {
    throw new Error(
      `${path} definition fingerprint changed during session construction.`
    );
  }
  if (!sameValueMap(snapshot.values, prepared.current.values)) {
    throw new Error(
      `${path} current values changed during session construction.`
    );
  }
  if (!sameValueMap(snapshot.originalValues, prepared.original.values)) {
    throw new Error(
      `${path} Original values changed during session construction.`
    );
  }
  if (!sameEvaluation(snapshot.evaluation, prepared.current.evaluation)) {
    throw new Error(
      `${path} current evaluation changed during session construction.`
    );
  }
  if (snapshot.dirty !== expectedDirty || snapshot.definitionError !== null) {
    throw new Error(
      `${path} did not establish the requested accepted Form baseline.`
    );
  }
  if (
    snapshot.docDescription !== prepared.docDescription ||
    snapshot.recordDescription !== prepared.recordDescription
  ) {
    throw new Error(
      `${path} descriptions changed during session construction.`
    );
  }
}

function sessionSeedValues(
  prepared: PreparedCompleteRevisionFormV2,
  options: WorkbenchRevisionSessionConstructionOptionsV2
): ReadonlyMap<string, DcmsValue> {
  const values =
    options.seedValuesByNode?.get(prepared.nodeId) ?? prepared.current.values;
  const fieldIds = new Set(prepared.definition.fields.map((field) => field.id));
  if (values.size !== fieldIds.size) {
    throw new Error(
      `Seed fixture for ${prepared.nodeId} must cover every accepted field exactly.`
    );
  }
  for (const fieldId of values.keys()) {
    if (!fieldIds.has(fieldId)) {
      throw new Error(
        `Seed fixture for ${prepared.nodeId} contains unknown field ${fieldId}.`
      );
    }
  }
  return cloneFrozenGraph(values);
}

function sessionForm(
  prepared: PreparedCompleteRevisionFormV2,
  options: WorkbenchRevisionSessionConstructionOptionsV2
) {
  return Object.freeze({
    nodeId: prepared.nodeId,
    title: prepared.title,
    scenario: prepared.scenario,
    seed: prepared.seed,
    section: prepared.section,
    step: prepared.step,
    docDescription: prepared.docDescription,
    recordDescription: prepared.recordDescription,
    model: cloneFrozenGraph(prepared.model),
    seedValues: sessionSeedValues(prepared, options),
    originalValues: prepared.original.values
  }) satisfies WorkbenchRevisionSessionFormV2;
}

/**
 * Construct one complete replacement session. No currently accepted session is
 * observed or changed. If validation fails after store creation, the candidate
 * store is disposed before the error escapes.
 */
export function createWorkbenchRevisionSessionV2(
  prepared: PreparedCompleteRevisionPackageV2,
  options: WorkbenchRevisionSessionConstructionOptionsV2 = {}
): WorkbenchRevisionSessionV2 {
  let store: WorkbenchStore | null = null;
  try {
    const candidateNodeIds = new Set(prepared.forms.map((form) => form.nodeId));
    if (options.seedValuesByNode) {
      for (const nodeId of options.seedValuesByNode.keys()) {
        if (!candidateNodeIds.has(nodeId)) {
          throw new Error(
            `Seed fixture references non-candidate Form node ${nodeId}.`
          );
        }
      }
    }
    if (options.dirtyByNode) {
      for (const [nodeId, dirty] of options.dirtyByNode) {
        if (!candidateNodeIds.has(nodeId)) {
          throw new Error(
            `Dirty-state fixture references non-candidate Form node ${nodeId}.`
          );
        }
        if (typeof dirty !== "boolean") {
          throw new Error(
            `Dirty-state fixture for ${nodeId} must be a boolean.`
          );
        }
      }
    }
    const forms = Object.freeze(
      prepared.forms.map((form) => sessionForm(form, options))
    );
    const formByNode = readonlyRecord(
      forms.map((form) => [form.nodeId, form] as const)
    );
    const modelByNode = readonlyRecord(
      forms.map((form) => [form.nodeId, form.model] as const)
    );

    store = createWorkbenchStore({
      revisionId: prepared.revision.revisionId,
      activeNodeId: prepared.activeNodeId,
      forms: prepared.forms.map((form) => ({
        nodeId: form.nodeId,
        title: form.title,
        definition: form.definition,
        values: form.current.values,
        originalValues: form.original.values,
        dirty: options.dirtyByNode?.get(form.nodeId) ?? false,
        docDescription: form.docDescription,
        recordDescription: form.recordDescription
      }))
    });

    const snapshot = store.getSnapshot();
    const expectedCanSubmitRevision = prepared.forms.every(
      (form) => !(options.dirtyByNode?.get(form.nodeId) ?? false)
    );
    if (
      snapshot.revisionId !== prepared.revision.revisionId ||
      snapshot.activeNodeId !== prepared.activeNodeId ||
      snapshot.forms.length !== prepared.forms.length ||
      snapshot.revisionSubmitted ||
      snapshot.canSubmitRevision !== expectedCanSubmitRevision
    ) {
      throw new Error(
        "Replacement store did not establish the prepared Revision baseline."
      );
    }
    snapshot.forms.forEach((form, index) => {
      const preparedForm = prepared.forms[index]!;
      assertFormSnapshotMatchesPrepared(
        form,
        preparedForm,
        index,
        options.dirtyByNode?.get(preparedForm.nodeId) ?? false
      );
    });

    return Object.freeze({
      revision: cloneFrozenGraph(prepared.revision),
      forms,
      formByNode,
      modelByNode,
      store
    });
  } catch (error) {
    store?.dispose();
    throw error;
  }
}

function withAcceptedModel(
  session: WorkbenchRevisionSessionV2,
  nodeId: string,
  model: WorkbenchFormModel
): WorkbenchRevisionSessionV2 {
  const accepted = session.store.getNode(nodeId);
  if (!accepted) throw new Error(`Unknown Workbench nodeId: ${nodeId}`);
  const definition: FormDefinition = formDefinitionFromWorkbenchModel(model);
  if (
    definition.formId !== accepted.definition.formId ||
    definition.version !== accepted.definition.version ||
    getCompiledPlanCacheKey(definition) !== accepted.definitionFingerprint
  ) {
    throw new Error(
      `Presentation model for ${nodeId} does not match its accepted Form definition.`
    );
  }

  const nextModel = cloneFrozenGraph(model);
  const forms = Object.freeze(
    session.forms.map((form) =>
      form.nodeId === nodeId
        ? Object.freeze({ ...form, model: nextModel })
        : form
    )
  );
  return Object.freeze({
    ...session,
    forms,
    formByNode: readonlyRecord(
      forms.map((form) => [form.nodeId, form] as const)
    ),
    modelByNode: readonlyRecord(
      forms.map((form) => [form.nodeId, form.model] as const)
    )
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Own one current application session and publish complete replacement sessions
 * through a single compare-and-swap boundary.
 */
export function createWorkbenchRevisionSessionManagerV2(
  initial: PreparedCompleteRevisionPackageV2
): WorkbenchRevisionSessionManagerV2 {
  let disposed = false;
  let snapshot: WorkbenchRevisionSessionManagerSnapshotV2 = Object.freeze({
    version: 0,
    session: createWorkbenchRevisionSessionV2(initial)
  });
  const listeners = new Set<() => void>();
  const retired: Array<{
    replacementVersion: number;
    session: WorkbenchRevisionSessionV2;
  }> = [];

  const assertLive = () => {
    if (disposed)
      throw new Error("Workbench Revision session manager disposed.");
  };

  const notify = () => {
    const errors: string[] = [];
    for (const callback of [...listeners]) {
      try {
        callback();
      } catch (error) {
        errors.push(message(error));
      }
    }
    return Object.freeze(errors);
  };

  const authorityIsCurrent = (authority: WorkbenchRevisionSessionAuthorityV2) =>
    authority.managerSnapshot === snapshot &&
    authority.storeSnapshot === snapshot.session.store.getSnapshot();

  return {
    subscribe(callback) {
      assertLive();
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    getSnapshot() {
      return snapshot;
    },

    captureAuthority() {
      assertLive();
      return Object.freeze({
        managerSnapshot: snapshot,
        storeSnapshot: snapshot.session.store.getSnapshot()
      });
    },

    replacePreparedCompleteRevision(prepared, authority, options = {}) {
      if (disposed) {
        return {
          accepted: false,
          code: "SESSION_MANAGER_DISPOSED",
          error: "Workbench Revision session manager disposed.",
          snapshot
        };
      }
      if (!authorityIsCurrent(authority)) {
        return {
          accepted: false,
          code: "SESSION_AUTHORITY_STALE",
          error:
            "The working Revision changed after replacement authority was captured.",
          snapshot
        };
      }

      let candidate: WorkbenchRevisionSessionV2;
      try {
        candidate = createWorkbenchRevisionSessionV2(prepared, options);
      } catch (error) {
        return {
          accepted: false,
          code: "SESSION_CANDIDATE_INVALID",
          error: message(error),
          snapshot
        };
      }

      if (!authorityIsCurrent(authority)) {
        candidate.store.dispose();
        return {
          accepted: false,
          code: "SESSION_AUTHORITY_STALE",
          error:
            "The working Revision changed while the replacement session was being constructed.",
          snapshot
        };
      }

      const previous = snapshot.session;
      const nextVersion = snapshot.version + 1;
      snapshot = Object.freeze({ version: nextVersion, session: candidate });
      retired.push({ replacementVersion: nextVersion, session: previous });
      const notificationErrors = notify();
      return { accepted: true, snapshot, notificationErrors };
    },

    adoptAcceptedFormModel(nodeId, model) {
      assertLive();
      snapshot = Object.freeze({
        version: snapshot.version + 1,
        session: withAcceptedModel(snapshot.session, nodeId, model)
      });
      notify();
    },

    releaseRetiredSessionsThrough(version) {
      assertLive();
      let released = 0;
      for (let index = retired.length - 1; index >= 0; index -= 1) {
        const item = retired[index]!;
        if (item.replacementVersion <= version) {
          item.session.store.dispose();
          retired.splice(index, 1);
          released += 1;
        }
      }
      return released;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      snapshot.session.store.dispose();
      for (const item of retired) item.session.store.dispose();
      retired.length = 0;
    }
  };
}
