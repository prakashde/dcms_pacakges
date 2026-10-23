/** Framework-neutral edit store; updates values immediately and evaluates affected rules synchronously. */
import {
  compileForm,
  evaluateRecord,
  evaluateChangeDetailed,
  getCompiledPlanCacheKey
} from "@dcms/form-rules";
/**
 * Create an in-memory synchronous store for the React adapter. Subscribe per field to avoid
 * unnecessary renders; getField preserves object identity for unaffected fields. Values and
 * returned evaluations are read-only to callers. For hostile formulas use the worker example.
 */
export function createFormStore(definition, initial = new Map()) {
  let plan = compileForm(definition),
    values = new Map(initial),
    evaluation = evaluateRecord(plan, values);
  const listeners = new Map();
  const global = new Set();
  const publish = (ids) => {
    for (const id of ids)
      for (const callback of listeners.get(id) ?? []) callback();
    for (const callback of global) callback();
  };
  return {
    subscribeField(id, callback) {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    },
    subscribe(callback) {
      global.add(callback);
      return () => {
        global.delete(callback);
      };
    },
    getField(id) {
      return evaluation.values.get(id);
    },
    getEvaluation: () => evaluation,
    // Evaluate prospective state first. A thrown boundary error must not commit half an edit.
    change(id, value) {
      const nextValues = new Map(values);
      nextValues.set(id, value);
      const result = evaluateChangeDetailed(plan, nextValues, evaluation, id);
      values = nextValues;
      evaluation = result.evaluation;
      publish(result.affectedFieldIds);
    },
    // Compare full content identity, prune removed fields and notify both old/new subscribers.
    replaceDefinition(next) {
      if (getCompiledPlanCacheKey(next) === plan.key) return;
      const nextPlan = compileForm(next);
      const nextValues = new Map(
        [...values].filter(([id]) => nextPlan.fields.has(id))
      );
      const nextEvaluation = evaluateRecord(nextPlan, nextValues);
      const ids = new Set([...plan.fieldOrder, ...nextPlan.fieldOrder]);
      plan = nextPlan;
      values = nextValues;
      evaluation = nextEvaluation;
      publish(ids);
    },
    // Persist entered values, never substitute calculated validation outputs. Nested arrays are shared.
    payload() {
      return {
        formId: plan.formId,
        formVersion: plan.version,
        values: Object.fromEntries(values)
      };
    }
  };
}
