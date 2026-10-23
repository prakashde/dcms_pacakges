/** Per-instance headless state for the React Workbench port. No DOM, persistence, auth, or database policy. */
import {
  compileForm,
  evaluateChangeDetailed,
  evaluateRecord,
  getCompiledPlanCacheKey,
  type CompiledFormPlan,
  type DcmsValue,
  type FormDefinition,
  type RecordEvaluation
} from "@dcms/form-rules";
import type { WorkbenchStoreMode } from "./contracts.js";
import {
  cloneFrozenGraph,
  freezeOwnedGraph,
  readonlyMapSnapshot
} from "./immutable.js";

export interface WorkbenchFormInput {
  nodeId: string;
  title: string;
  definition: FormDefinition;
  values?: ReadonlyMap<string, DcmsValue> | Readonly<Record<string, DcmsValue>>;
  originalValues?:
    | ReadonlyMap<string, DcmsValue>
    | Readonly<Record<string, DcmsValue>>;
  dirty?: boolean;
  docDescription?: string;
  recordDescription?: string;
}

export interface WorkbenchFormSnapshot {
  readonly nodeId: string;
  readonly title: string;
  readonly definition: FormDefinition;
  readonly definitionFingerprint: string;
  readonly values: ReadonlyMap<string, DcmsValue>;
  readonly originalValues: ReadonlyMap<string, DcmsValue>;
  readonly evaluation: RecordEvaluation | null;
  readonly definitionError: string | null;
  readonly dirty: boolean;
  readonly docDescription: string;
  readonly recordDescription: string;
}

export interface WorkbenchSnapshot {
  readonly revisionId: string;
  readonly mode: WorkbenchStoreMode;
  readonly activeNodeId: string | null;
  readonly forms: readonly WorkbenchFormSnapshot[];
  readonly revisionSubmitted: boolean;
  readonly canSubmitRevision: boolean;
}

export interface WorkbenchStoreOptions {
  revisionId: string;
  forms: readonly WorkbenchFormInput[];
  activeNodeId?: string | null;
  mode?: WorkbenchStoreMode;
}

export interface DefinitionUpdateResult {
  accepted: boolean;
  error?: string;
}

interface MutableWorkbenchFormState {
  nodeId: string;
  title: string;
  definition: FormDefinition;
  definitionFingerprint: string;
  values: Map<string, DcmsValue>;
  originalValues: Map<string, DcmsValue>;
  plan: CompiledFormPlan;
  evaluation: RecordEvaluation;
  dirty: boolean;
  docDescription: string;
  recordDescription: string;
}

interface MutableWorkbenchForm extends MutableWorkbenchFormState {
  snapshot: WorkbenchFormSnapshot;
}

function cloneValue(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

function toValueMap(
  values:
    | ReadonlyMap<string, DcmsValue>
    | Readonly<Record<string, DcmsValue>>
    | undefined
): Map<string, DcmsValue> {
  const entries =
    values instanceof Map ? values.entries() : Object.entries(values ?? {});
  return new Map([...entries].map(([id, value]) => [id, cloneValue(value)]));
}

function snapshotValues(values: ReadonlyMap<string, DcmsValue>) {
  return readonlyMapSnapshot(values, (value) => cloneFrozenGraph(value));
}

function makeFormSnapshot(
  form: MutableWorkbenchFormState
): WorkbenchFormSnapshot {
  return Object.freeze({
    nodeId: form.nodeId,
    title: form.title,
    definition: form.definition,
    definitionFingerprint: form.definitionFingerprint,
    values: snapshotValues(form.values),
    originalValues: snapshotValues(form.originalValues),
    evaluation: form.evaluation,
    definitionError: null,
    dirty: form.dirty,
    docDescription: form.docDescription,
    recordDescription: form.recordDescription
  });
}

function createMutableForm(input: WorkbenchFormInput): MutableWorkbenchForm {
  const definition = cloneFrozenGraph(input.definition);
  const plan = compileForm(definition);
  const values = toValueMap(input.values);
  const originalValues = input.originalValues
    ? toValueMap(input.originalValues)
    : new Map([...values].map(([id, value]) => [id, cloneValue(value)]));
  const state: MutableWorkbenchFormState = {
    nodeId: input.nodeId,
    title: input.title,
    definition,
    definitionFingerprint: getCompiledPlanCacheKey(definition),
    values,
    originalValues,
    plan,
    evaluation: freezeOwnedGraph(evaluateRecord(plan, values)),
    dirty: !!input.dirty,
    docDescription: input.docDescription ?? "",
    recordDescription: input.recordDescription ?? ""
  };
  return {
    ...state,
    snapshot: makeFormSnapshot(state)
  };
}

/**
 * Create one isolated Workbench state controller. The store is synchronous and deterministic;
 * production persistence and asynchronous worker scheduling belong behind host services.
 */
export function createWorkbenchStore(options: WorkbenchStoreOptions) {
  const forms = new Map<string, MutableWorkbenchForm>();
  for (const input of options.forms) {
    if (forms.has(input.nodeId)) {
      throw new Error(`Duplicate Workbench nodeId: ${input.nodeId}`);
    }
    forms.set(input.nodeId, createMutableForm(input));
  }

  let mode = options.mode ?? "editor";
  let activeNodeId =
    options.activeNodeId === undefined
      ? (options.forms[0]?.nodeId ?? null)
      : options.activeNodeId;
  if (activeNodeId !== null && !forms.has(activeNodeId)) {
    throw new Error(`Unknown active Workbench nodeId: ${activeNodeId}`);
  }
  let revisionSubmitted = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const nodeListeners = new Map<string, Set<() => void>>();
  let snapshot: WorkbenchSnapshot;

  const canSubmitRevision = () =>
    forms.size > 0 &&
    [...forms.values()].every((form) => !form.dirty) &&
    !revisionSubmitted;

  const rebuildSnapshot = () => {
    snapshot = {
      revisionId: options.revisionId,
      mode,
      activeNodeId,
      forms: Object.freeze([...forms.values()].map((form) => form.snapshot)),
      revisionSubmitted,
      canSubmitRevision: canSubmitRevision()
    };
    snapshot = Object.freeze(snapshot);
  };

  const assertLive = () => {
    if (disposed) throw new Error("Workbench store has been disposed.");
  };

  const getMutableForm = (nodeId: string) => {
    const form = forms.get(nodeId);
    if (!form) throw new Error(`Unknown Workbench nodeId: ${nodeId}`);
    return form;
  };

  const publish = (nodeIds: Iterable<string> = []) => {
    rebuildSnapshot();
    for (const nodeId of nodeIds) {
      for (const callback of nodeListeners.get(nodeId) ?? []) callback();
    }
    for (const callback of listeners) callback();
  };

  rebuildSnapshot();

  return {
    subscribe(callback: () => void) {
      assertLive();
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    subscribeNode(nodeId: string, callback: () => void) {
      assertLive();
      getMutableForm(nodeId);
      let set = nodeListeners.get(nodeId);
      if (!set) {
        set = new Set();
        nodeListeners.set(nodeId, set);
      }
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    },

    getSnapshot() {
      return snapshot;
    },

    getNode(nodeId: string) {
      return forms.get(nodeId)?.snapshot;
    },

    getActiveNode() {
      return activeNodeId === null
        ? undefined
        : forms.get(activeNodeId)?.snapshot;
    },

    selectNode(nodeId: string) {
      assertLive();
      getMutableForm(nodeId);
      if (activeNodeId === nodeId) return;
      activeNodeId = nodeId;
      publish();
    },

    setMode(next: WorkbenchStoreMode) {
      assertLive();
      if (mode === next) return;
      mode = next;
      publish();
    },

    /**
     * Evaluate the prospective Record state before committing it. This keeps
     * entered/source values and their displayed evaluation from drifting apart.
     */
    changeRecordValue(nodeId: string, fieldId: string, value: DcmsValue) {
      assertLive();
      const form = getMutableForm(nodeId);
      if (!form.plan.fields.has(fieldId)) {
        throw new Error(
          `Unknown fieldId ${fieldId} in Workbench node ${nodeId}`
        );
      }
      const nextValues = new Map(form.values);
      nextValues.set(fieldId, cloneValue(value));
      const result = evaluateChangeDetailed(
        form.plan,
        nextValues,
        form.evaluation,
        fieldId
      );
      form.values = nextValues;
      form.evaluation = freezeOwnedGraph(result.evaluation);
      form.snapshot = makeFormSnapshot(form);
      publish([nodeId]);
      return result.affectedFieldIds;
    },

    /**
     * Atomically replace a Record value set for restore/import/load operations.
     * Unknown field IDs are pruned and the surviving values are fully reevaluated
     * before one matching snapshot is published.
     */
    replaceRecordValues(
      nodeId: string,
      next: ReadonlyMap<string, DcmsValue> | Readonly<Record<string, DcmsValue>>
    ) {
      assertLive();
      const form = getMutableForm(nodeId);
      const candidate = toValueMap(next);
      const filtered = new Map(
        [...candidate].filter(([fieldId]) => form.plan.fields.has(fieldId))
      );
      const evaluation = freezeOwnedGraph(evaluateRecord(form.plan, filtered));
      form.values = filtered;
      form.evaluation = evaluation;
      form.snapshot = makeFormSnapshot(form);
      publish([nodeId]);
    },

    /**
     * Atomically replace current and Original Record values for several Forms.
     * Every candidate is fully evaluated before any accepted Form changes. This
     * boundary exists for the strict record-values package scope, whose contract
     * carries the two value sets together.
     */
    replaceRecordStateBatch(
      updates: Readonly<
        Record<
          string,
          {
            readonly currentValues:
              | ReadonlyMap<string, DcmsValue>
              | Readonly<Record<string, DcmsValue>>;
            readonly originalValues:
              | ReadonlyMap<string, DcmsValue>
              | Readonly<Record<string, DcmsValue>>;
          }
        >
      >
    ) {
      assertLive();
      const prepared = new Map<
        string,
        {
          values: Map<string, DcmsValue>;
          originalValues: Map<string, DcmsValue>;
          evaluation: RecordEvaluation;
        }
      >();

      for (const [nodeId, next] of Object.entries(updates)) {
        const form = getMutableForm(nodeId);
        const currentCandidate = toValueMap(next.currentValues);
        const originalCandidate = toValueMap(next.originalValues);
        const values = new Map(
          [...currentCandidate].filter(([fieldId]) =>
            form.plan.fields.has(fieldId)
          )
        );
        const originalValues = new Map(
          [...originalCandidate].filter(([fieldId]) =>
            form.plan.fields.has(fieldId)
          )
        );
        prepared.set(nodeId, {
          values,
          originalValues,
          evaluation: freezeOwnedGraph(evaluateRecord(form.plan, values))
        });
      }

      for (const [nodeId, next] of prepared) {
        const form = getMutableForm(nodeId);
        form.values = next.values;
        form.originalValues = next.originalValues;
        form.evaluation = next.evaluation;
        form.snapshot = makeFormSnapshot(form);
      }

      rebuildSnapshot();
      const notificationErrors: string[] = [];
      for (const nodeId of prepared.keys()) {
        for (const callback of nodeListeners.get(nodeId) ?? []) {
          try {
            callback();
          } catch (error) {
            notificationErrors.push(
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
      for (const callback of listeners) {
        try {
          callback();
        } catch (error) {
          notificationErrors.push(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      return Object.freeze(notificationErrors);
    },

    /**
     * Compile and evaluate a proposed Form definition before replacing accepted
     * state. Caller-owned definitions are cloned before compilation so later
     * external mutation cannot change accepted Workbench state.
     */
    replaceFormDefinition(
      nodeId: string,
      next: FormDefinition
    ): DefinitionUpdateResult {
      assertLive();
      const form = getMutableForm(nodeId);
      try {
        const nextDefinition = cloneFrozenGraph(next);
        const nextFingerprint = getCompiledPlanCacheKey(nextDefinition);
        if (nextFingerprint === form.definitionFingerprint) {
          return { accepted: true };
        }
        const nextPlan = compileForm(nextDefinition);
        const nextValues = new Map(
          [...form.values].filter(([fieldId]) => nextPlan.fields.has(fieldId))
        );
        const nextEvaluation = freezeOwnedGraph(
          evaluateRecord(nextPlan, nextValues)
        );
        form.definition = nextDefinition;
        form.definitionFingerprint = nextFingerprint;
        form.plan = nextPlan;
        form.values = nextValues;
        form.evaluation = nextEvaluation;
        form.dirty = true;
        form.snapshot = makeFormSnapshot(form);
        revisionSubmitted = false;
        publish([nodeId]);
        return { accepted: true };
      } catch (error) {
        return {
          accepted: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    /**
     * Atomically replace one Form definition and its Record values. Both are
     * compiled/evaluated before a single accepted snapshot is published.
     */
    replaceFormState(
      nodeId: string,
      nextDefinition: FormDefinition,
      nextValuesInput:
        | ReadonlyMap<string, DcmsValue>
        | Readonly<Record<string, DcmsValue>>
    ): DefinitionUpdateResult {
      assertLive();
      const form = getMutableForm(nodeId);
      try {
        const acceptedDefinition = cloneFrozenGraph(nextDefinition);
        const nextFingerprint = getCompiledPlanCacheKey(acceptedDefinition);
        const definitionChanged =
          nextFingerprint !== form.definitionFingerprint;
        const nextPlan = definitionChanged
          ? compileForm(acceptedDefinition)
          : form.plan;
        const candidate = toValueMap(nextValuesInput);
        const nextValues = new Map(
          [...candidate].filter(([fieldId]) => nextPlan.fields.has(fieldId))
        );
        const nextEvaluation = freezeOwnedGraph(
          evaluateRecord(nextPlan, nextValues)
        );

        if (definitionChanged) {
          form.definition = acceptedDefinition;
          form.definitionFingerprint = nextFingerprint;
          form.plan = nextPlan;
          form.dirty = true;
          revisionSubmitted = false;
        }
        form.values = nextValues;
        form.evaluation = nextEvaluation;
        form.snapshot = makeFormSnapshot(form);
        publish([nodeId]);
        return { accepted: true };
      } catch (error) {
        return {
          accepted: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    /**
     * Atomically replace Record values for several Forms. Every candidate is
     * fully evaluated before any accepted Form is changed or one snapshot is
     * published.
     */
    replaceRecordValuesBatch(
      updates: Readonly<
        Record<
          string,
          ReadonlyMap<string, DcmsValue> | Readonly<Record<string, DcmsValue>>
        >
      >
    ) {
      assertLive();
      const prepared = new Map<
        string,
        { values: Map<string, DcmsValue>; evaluation: RecordEvaluation }
      >();

      for (const [nodeId, next] of Object.entries(updates)) {
        const form = getMutableForm(nodeId);
        const candidate = toValueMap(next);
        const values = new Map(
          [...candidate].filter(([fieldId]) => form.plan.fields.has(fieldId))
        );
        prepared.set(nodeId, {
          values,
          evaluation: freezeOwnedGraph(evaluateRecord(form.plan, values))
        });
      }

      for (const [nodeId, next] of prepared) {
        const form = getMutableForm(nodeId);
        form.values = next.values;
        form.evaluation = next.evaluation;
        form.snapshot = makeFormSnapshot(form);
      }
      publish(prepared.keys());
    },

    setDescriptions(
      nodeId: string,
      descriptions: { docDescription?: string; recordDescription?: string }
    ) {
      assertLive();
      const form = getMutableForm(nodeId);
      const nextDoc = descriptions.docDescription ?? form.docDescription;
      const nextRecord =
        descriptions.recordDescription ?? form.recordDescription;
      if (
        nextDoc === form.docDescription &&
        nextRecord === form.recordDescription
      ) {
        return;
      }
      form.docDescription = nextDoc;
      form.recordDescription = nextRecord;
      form.dirty = true;
      form.snapshot = makeFormSnapshot(form);
      revisionSubmitted = false;
      publish([nodeId]);
    },

    /**
     * Mark the in-memory authoring snapshot saved. Production durability belongs
     * to the host; callers should use this only after the corresponding host Save
     * has succeeded.
     */
    saveForm(nodeId: string) {
      assertLive();
      const form = getMutableForm(nodeId);
      if (!form.dirty) return;
      form.dirty = false;
      form.snapshot = makeFormSnapshot(form);
      publish([nodeId]);
    },

    canSubmitRevision,

    /**
     * Perform the local authoring-readiness transition used by the reference UI.
     * Production Revision workflow/authorization remains a DCMS host concern.
     */
    submitRevision() {
      assertLive();
      if (!canSubmitRevision()) return false;
      revisionSubmitted = true;
      mode = "revision";
      publish();
      return true;
    },

    recordPayload(nodeId: string) {
      const form = getMutableForm(nodeId);
      return {
        formId: form.plan.formId,
        formVersion: form.plan.version,
        values: Object.fromEntries(snapshotValues(form.values))
      };
    },

    dispose() {
      listeners.clear();
      nodeListeners.clear();
      disposed = true;
    }
  };
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;
