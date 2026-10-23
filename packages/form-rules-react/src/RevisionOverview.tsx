/** Revision authoring summary; Record validation remains a separate state axis. */
import type { WorkbenchSnapshot } from "./workbench-store.js";

export interface RevisionOverviewProps {
  snapshot: WorkbenchSnapshot;
  onEdit(nodeId: string): void;
  onSaveForm?(nodeId: string): void;
  onSubmitRevision(): void;
}

function recordState(form: WorkbenchSnapshot["forms"][number]) {
  if (form.definitionError) return "definition_error";
  if (form.evaluation?.errorFieldIds.length) return "evaluation_error";
  if (form.evaluation?.blockingFieldIds.length) return "blocking";
  if (form.evaluation?.warningFieldIds.length) return "warning";
  return "ready";
}

/**
 * Summarize authoring save state separately from current Record rule state.
 *
 * A saved Form can still have a blocked Record, and a valid Record can belong
 * to a Form with unsaved authoring changes. The UI keeps those axes separate.
 */
export function RevisionOverview({
  snapshot,
  onEdit,
  onSaveForm,
  onSubmitRevision
}: RevisionOverviewProps) {
  const saved = snapshot.forms.filter((form) => !form.dirty).length;
  const dirty = snapshot.forms.length - saved;

  return (
    <section className="dcms-revision-overview" aria-label="Revision overview">
      <header>
        <h1>Revision {snapshot.revisionId}</h1>
        <p>
          {snapshot.forms.length} Form Element(s) · {saved} saved · {dirty}{" "}
          unsaved
        </p>
        <button
          type="button"
          disabled={!snapshot.canSubmitRevision}
          onClick={onSubmitRevision}
        >
          Submit Revision
        </button>
      </header>

      {snapshot.forms.map((form, index) => (
        <article
          key={form.nodeId}
          data-node-id={form.nodeId}
          aria-label={`Form ${index + 1}: ${form.title}`}
        >
          <h2>
            {index + 1}. {form.title}
          </h2>
          <p data-authoring-state={form.dirty ? "dirty" : "saved"}>
            {form.dirty ? "Unsaved authoring changes" : "Form saved"}
          </p>
          <p data-record-state={recordState(form)}>
            Record state: {recordState(form)}
          </p>
          <button
            type="button"
            aria-label={`Edit ${form.title}`}
            onClick={() => onEdit(form.nodeId)}
          >
            Edit
          </button>
          {onSaveForm ? (
            <button
              type="button"
              aria-label={`Save ${form.title}`}
              disabled={!form.dirty}
              onClick={() => onSaveForm(form.nodeId)}
            >
              Save Form
            </button>
          ) : null}
        </article>
      ))}

      {snapshot.revisionSubmitted ? (
        <p role="status" aria-live="polite">
          Revision authoring state submitted.
        </p>
      ) : null}
    </section>
  );
}
