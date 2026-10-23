/** Controlled React surface for one authority-bound pair of Form descriptions. */
import { useEffect, useRef } from "react";
import { DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS } from "./workbench-package-contracts.js";
import type {
  WorkbenchFormDescriptionsV2,
  WorkbenchFormDescriptionWorkingCopyV2
} from "./workbench-description-authoring.js";
import type { WorkbenchFormSnapshot } from "./workbench-store.js";

export interface FormDescriptionEditorProps {
  accepted: Pick<
    WorkbenchFormSnapshot,
    "nodeId" | "docDescription" | "recordDescription"
  >;
  workingCopy: WorkbenchFormDescriptionWorkingCopyV2 | null;
  /** Prevent opening a description draft while another authoring draft is open. */
  disabled?: boolean;
  disabledReason?: string;
  onBegin(): void;
  onChange(changes: Partial<WorkbenchFormDescriptionsV2>): void;
  onConfirm(): void;
  onCancel(): void;
}

function DescriptionToolbar() {
  return (
    <div className="dcms-description-toolbar" aria-hidden="true">
      ↶ &nbsp; ↷ &nbsp;&nbsp; Normal &nbsp; | &nbsp; T &nbsp; Arial &nbsp; |
      &nbsp; 15 &nbsp; + B / U &nbsp; ↔ &nbsp; Aa &nbsp; + Insert &nbsp; Left
      Align
    </div>
  );
}

function AcceptedDescription({ label, text }: { label: string; text: string }) {
  return (
    <section className="dcms-description-surface" aria-label={label}>
      <h3>{label}</h3>
      <DescriptionToolbar />
      <div
        role="textbox"
        aria-label={`${label} accepted value`}
        aria-readonly="true"
        className="dcms-description-body"
      >
        {text}
      </div>
    </section>
  );
}

function EditableDescription({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <section className="dcms-description-surface" aria-label={label}>
      <h3>{label}</h3>
      <DescriptionToolbar />
      <textarea
        className="dcms-description-body dcms-description-input"
        aria-label={label}
        value={value}
        maxLength={DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </section>
  );
}

/**
 * Present accepted descriptions until Edit opens one detached working copy.
 * Confirm and Cancel are delegated to the application transaction owner.
 */
export function FormDescriptionEditor({
  accepted,
  workingCopy,
  disabled = false,
  disabledReason,
  onBegin,
  onChange,
  onConfirm,
  onCancel
}: FormDescriptionEditorProps) {
  const editing = workingCopy?.nodeId === accepted.nodeId;
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (wasEditingRef.current && !editing) editButtonRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  return (
    <section
      className="dcms-form-description-editor"
      aria-label="Form descriptions"
      data-editing={editing ? "true" : "false"}
    >
      <header className="dcms-description-editor-heading">
        <div>
          <h2>Form Descriptions</h2>
          <p>
            Confirm updates the working Form. Save Form remains a separate
            authoring action.
          </p>
        </div>
        {!editing ? (
          <button
            ref={editButtonRef}
            type="button"
            className="dcms-description-edit-action"
            disabled={disabled}
            title={
              disabled
                ? (disabledReason ?? "Finish the active authoring edit first")
                : "Edit both Form descriptions"
            }
            onClick={onBegin}
          >
            Edit descriptions
          </button>
        ) : (
          <span
            className="dcms-description-draft-status"
            data-dirty={workingCopy.dirty ? "true" : "false"}
          >
            {workingCopy.dirty ? "Unsaved description draft" : "No changes"}
          </span>
        )}
      </header>

      {editing ? (
        <>
          <EditableDescription
            label="Short Description in Document"
            value={workingCopy.draft.docDescription}
            onChange={(docDescription) => onChange({ docDescription })}
          />
          <EditableDescription
            label="Short Description in Record"
            value={workingCopy.draft.recordDescription}
            onChange={(recordDescription) => onChange({ recordDescription })}
          />
          <footer className="dcms-description-editor-actions">
            <button
              type="button"
              className="dcms-description-confirm-action"
              onClick={onConfirm}
            >
              Confirm descriptions
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </footer>
        </>
      ) : (
        <>
          <AcceptedDescription
            label="Short Description in Document"
            text={accepted.docDescription}
          />
          <AcceptedDescription
            label="Short Description in Record"
            text={accepted.recordDescription}
          />
          {disabled && disabledReason ? (
            <p className="dcms-description-disabled-reason" role="status">
              {disabledReason}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
