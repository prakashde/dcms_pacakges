/** Bundle this module as a browser worker; it uses exactly the same package as Express. */
import { compileForm, evaluateRecordPayload } from "@dcms/form-rules";
let plan;
const diagnostic = (e) => ({
  code: e?.code ?? "EVALUATION_FAILED",
  message: e instanceof Error ? e.message : String(e)
});
self.onmessage = ({ data }) => {
  if (data.type === "initialize") {
    try {
      plan = compileForm(data.definition);
      self.postMessage({ type: "ready", generation: data.generation });
    } catch (e) {
      self.postMessage({
        type: "initialization-error",
        generation: data.generation,
        error: diagnostic(e)
      });
    }
    return;
  }
  if (data.type === "evaluate") {
    try {
      self.postMessage({
        generation: data.generation,
        revision: data.revision,
        evaluation: evaluateRecordPayload(plan, data.payload)
      });
    } catch (e) {
      self.postMessage({
        generation: data.generation,
        revision: data.revision,
        error: diagnostic(e)
      });
    }
  }
};
