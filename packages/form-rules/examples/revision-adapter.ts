/** Runnable Revision controller using independent Form scopes and package-owned aggregation. */
import {
  compileRevision,
  evaluateRevision,
  evaluateRevisionChangeDetailed,
  type RevisionDefinition,
  type DcmsValue
} from "@dcms/form-rules";
/**
 * Manage entered values for independent Form Elements and delegate aggregation to the engine.
 * Evaluation precedes state replacement so rejected edits leave the controller unchanged.
 * This synchronous illustration has no authorization, transaction or persistence layer.
 */
export function createRevisionController(
  definition: RevisionDefinition,
  initial: ReadonlyMap<string, ReadonlyMap<string, DcmsValue>> = new Map()
) {
  const plan = compileRevision(definition);
  const values = new Map([...initial].map(([id, v]) => [id, new Map(v)]));
  let evaluation = evaluateRevision(plan, values);
  return {
    getEvaluation: () => evaluation,
    change(nodeId: string, fieldId: string, value: DcmsValue) {
      const next = new Map(values.get(nodeId));
      next.set(fieldId, value);
      const all = new Map(values);
      all.set(nodeId, next);
      const detail = evaluateRevisionChangeDetailed(
        plan,
        all,
        evaluation,
        nodeId,
        fieldId
      );
      values.set(nodeId, next);
      evaluation = detail.evaluation;
      return detail;
    }
  };
}
