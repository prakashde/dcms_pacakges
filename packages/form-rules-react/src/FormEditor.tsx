/** Controlled React Form-authoring surface for the Workbench model. */
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { DefinitionUpdateResult } from "./workbench-store.js";
import type {
  WorkbenchFieldModel,
  WorkbenchFormModel
} from "./workbench-model.js";
import {
  addWorkbenchField,
  applyWorkbenchFieldCategory,
  cloneWorkbenchField,
  deleteWorkbenchField,
  reorderWorkbenchField,
  replaceWorkbenchField
} from "./form-editor.js";
import { ValidationRowEditor } from "./ValidationRowEditor.js";

export interface FormEditorProps {
  model: WorkbenchFormModel;
  onChange(model: WorkbenchFormModel): DefinitionUpdateResult | void;
  /** Prevent opening or applying a field edit while another authoring draft owns the Form. */
  disabled?: boolean;
  disabledReason?: string;
  /** Reports the one field row whose working copy is currently open. */
  onEditingFieldChange?(fieldId: string | null): void;
  /**
   * Optional accepted Record context supplied by an application composition.
   *
   * The editor renders this context as read-only evidence beside the accepted
   * Form definition. It never mutates Record values or derives rule meaning.
   */
  acceptedRecordContext?: Readonly<
    Record<string, FormEditorAcceptedFieldContext>
  >;
}

export type FormEditorAcceptedFieldState =
  | "valid"
  | "warning"
  | "blocking"
  | "error"
  | "not_validated"
  | "not_evaluated";

export interface FormEditorAcceptedFieldContext {
  readonly valueText: string;
  readonly validationText: string;
  readonly validationState: FormEditorAcceptedFieldState;
}

function optionsAllowed(field: WorkbenchFieldModel) {
  return field.category === "Radio" || field.category === "Checkbox";
}

function optionSummary(field: WorkbenchFieldModel) {
  if (!optionsAllowed(field)) return "Not applicable";
  if (field.options.length === 0) return "No options";
  return field.options.join(", ");
}

const FIELD_CATEGORIES = [
  "Radio",
  "Number",
  "Text",
  "Rich Text",
  "Checkbox"
] as const;

type FormContext = Pick<WorkbenchFormModel, "formId" | "formVersion">;

type FieldWorkingCopy = FormContext & {
  field: WorkbenchFieldModel;
};

function sameFormContext(left: FormContext, right: FormContext) {
  return left.formId === right.formId && left.formVersion === right.formVersion;
}

/**
 * Edit Workbench Form presentation and validation metadata.
 *
 * The accepted table always presents control-shaped, disabled evidence. Edit
 * opens exactly one field working copy. Category, label, options and
 * mustBeCorrect then become editable in that row; its Validation Rule button
 * opens a rules-only modal for the same draft. Confirm proposes the complete
 * field once through onChange. Cancel discards the complete draft.
 */
export function FormEditor({
  model,
  onChange,
  onEditingFieldChange,
  acceptedRecordContext,
  disabled = false,
  disabledReason
}: FormEditorProps) {
  const [workingCopy, setWorkingCopy] = useState<FieldWorkingCopy | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<
    (FormContext & { message: string }) | null
  >(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const validationReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const validationWasOpenRef = useRef(false);

  const apply = (next: WorkbenchFormModel): DefinitionUpdateResult => {
    const result = onChange(next) ?? { accepted: true };
    if (!result.accepted) {
      setErrorState({
        formId: model.formId,
        formVersion: model.formVersion,
        message: result.error ?? "Form definition was not accepted."
      });
      return result;
    }
    setErrorState(null);
    return result;
  };

  const acceptedEditingField =
    workingCopy && sameFormContext(workingCopy, model)
      ? model.fields.find((field) => field.id === workingCopy.field.id)
      : undefined;
  const editingField = acceptedEditingField ? workingCopy?.field : undefined;
  const error =
    errorState && sameFormContext(errorState, model) ? errorState.message : "";
  const editingLocked = Boolean(editingField);
  const authoringLocked = disabled || editingLocked;

  useEffect(() => {
    onEditingFieldChange?.(editingField?.id ?? null);
  }, [editingField?.id, onEditingFieldChange]);

  useEffect(() => {
    if (!workingCopy) return;
    if (sameFormContext(workingCopy, model) && acceptedEditingField) return;
    returnFocusRef.current = null;
    validationReturnFocusRef.current = null;
    setValidationDialogOpen(false);
    setWorkingCopy(null);
  }, [acceptedEditingField, model.formId, model.formVersion, workingCopy]);

  useEffect(() => {
    if (!errorState || sameFormContext(errorState, model)) return;
    setErrorState(null);
  }, [errorState, model.formId, model.formVersion]);

  useEffect(() => {
    if (workingCopy !== null) return;
    const trigger = returnFocusRef.current;
    if (!trigger) return;
    returnFocusRef.current = null;
    trigger.focus();
  }, [workingCopy]);

  useEffect(() => {
    if (validationWasOpenRef.current && !validationDialogOpen) {
      const trigger = validationReturnFocusRef.current;
      validationReturnFocusRef.current = null;
      trigger?.focus();
    }
    validationWasOpenRef.current = validationDialogOpen;
  }, [validationDialogOpen]);

  const setWorkingField = (
    update: (field: WorkbenchFieldModel) => WorkbenchFieldModel
  ) => {
    setWorkingCopy((current) =>
      current
        ? {
            ...current,
            field: cloneWorkbenchField(
              update(cloneWorkbenchField(current.field))
            )
          }
        : current
    );
    setErrorState(null);
  };

  const closeRowEditor = () => {
    validationReturnFocusRef.current = null;
    setValidationDialogOpen(false);
    setWorkingCopy(null);
    setErrorState(null);
  };

  const openRowEditor = (
    field: WorkbenchFieldModel,
    trigger: HTMLButtonElement
  ) => {
    returnFocusRef.current = trigger;
    setErrorState(null);
    setWorkingCopy({
      formId: model.formId,
      formVersion: model.formVersion,
      field: cloneWorkbenchField(field)
    });
  };

  const confirmRowEditor = () => {
    if (!editingField) return;
    const result = apply(replaceWorkbenchField(model, editingField));
    if (result.accepted) closeRowEditor();
  };

  const openValidationEditor = (trigger: HTMLButtonElement) => {
    if (!editingField) return;
    validationReturnFocusRef.current = trigger;
    setValidationDialogOpen(true);
  };

  const reorderField = (fieldId: string, targetIndex: number) => {
    try {
      const next = reorderWorkbenchField(model, fieldId, targetIndex);
      if (next !== model) apply(next);
    } catch (caught) {
      setErrorState({
        formId: model.formId,
        formVersion: model.formVersion,
        message: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setDraggingFieldId(null);
    }
  };

  const beginDrag = (event: DragEvent<HTMLButtonElement>, fieldId: string) => {
    if (authoringLocked) {
      event.preventDefault();
      return;
    }
    setDraggingFieldId(fieldId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", fieldId);
  };

  const showAcceptedRecordContext = acceptedRecordContext !== undefined;

  return (
    <section className="dcms-form-editor" aria-label="Form editor">
      <p className="dcms-form-editor-instruction">
        Accepted controls are read-only. Choose Edit to change one field, then
        open its Validation Rule button to edit rules.
      </p>
      {disabled && disabledReason ? (
        <p className="dcms-form-editor-lock-reason" role="status">
          {disabledReason}
        </p>
      ) : null}
      <div
        data-form-editor-background
        inert={validationDialogOpen}
        aria-hidden={validationDialogOpen ? true : undefined}
      >
        <div className="dcms-form-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Field Category</th>
                <th scope="col">Label Description</th>
                <th scope="col">Options</th>
                <th scope="col">Validation Rule</th>
                <th scope="col">Must Be Correct?</th>
                {showAcceptedRecordContext ? <th scope="col">Value</th> : null}
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {model.fields.map((acceptedField, index) => {
                const isEditing = editingField?.id === acceptedField.id;
                const rowField = isEditing ? editingField : acceptedField;
                const acceptedContext =
                  acceptedRecordContext?.[acceptedField.id];
                const rowDisabled =
                  disabled || !isEditing || validationDialogOpen;
                const otherRowLocked =
                  disabled || (editingLocked && !isEditing);
                return (
                  <tr
                    key={acceptedField.id}
                    data-field-id={acceptedField.id}
                    data-must-be-correct={String(acceptedField.mustBeCorrect)}
                    data-editing={isEditing ? "true" : "false"}
                    data-drop-target={
                      draggingFieldId && draggingFieldId !== acceptedField.id
                        ? "true"
                        : undefined
                    }
                    onDragOver={(event) => {
                      if (!authoringLocked && draggingFieldId) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      if (authoringLocked) return;
                      event.preventDefault();
                      const fieldId =
                        draggingFieldId ||
                        event.dataTransfer.getData("text/plain");
                      if (fieldId) reorderField(fieldId, index);
                    }}
                  >
                    <td className="dcms-field-order-cell">
                      <div className="dcms-field-order-controls">
                        <button
                          type="button"
                          className="dcms-field-drag-action"
                          aria-label={`Drag field ${index + 1}: ${acceptedField.label}`}
                          title={
                            authoringLocked
                              ? (disabledReason ??
                                "Finish the active authoring edit before reordering")
                              : "Drag to reorder"
                          }
                          draggable={!authoringLocked}
                          disabled={authoringLocked}
                          onDragStart={(event) =>
                            beginDrag(event, acceptedField.id)
                          }
                          onDragEnd={() => setDraggingFieldId(null)}
                        >
                          <span aria-hidden="true">⋮⋮</span>
                        </button>
                        <span
                          className="dcms-field-order-number"
                          aria-label={`Field order ${index + 1}: ${acceptedField.label}`}
                        >
                          {index + 1}
                        </span>
                        <span className="dcms-field-order-buttons">
                          <button
                            type="button"
                            aria-label={`Move field ${index + 1} up: ${acceptedField.label}`}
                            title="Move up"
                            disabled={authoringLocked || index === 0}
                            onClick={() =>
                              reorderField(acceptedField.id, index - 1)
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move field ${index + 1} down: ${acceptedField.label}`}
                            title="Move down"
                            disabled={
                              authoringLocked ||
                              index === model.fields.length - 1
                            }
                            onClick={() =>
                              reorderField(acceptedField.id, index + 1)
                            }
                          >
                            ↓
                          </button>
                        </span>
                      </div>
                    </td>
                    <td>
                      <select
                        className="dcms-field-category-control"
                        aria-label={`Field category ${index + 1}: ${acceptedField.label}`}
                        value={rowField.category}
                        disabled={rowDisabled}
                        onChange={(event) =>
                          setWorkingField((current) =>
                            applyWorkbenchFieldCategory(
                              current,
                              event.target
                                .value as WorkbenchFieldModel["category"]
                            )
                          )
                        }
                      >
                        {FIELD_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div
                        className={
                          rowField.category === "Number"
                            ? "dcms-field-label-unit-grid"
                            : undefined
                        }
                      >
                        <input
                          className="dcms-field-label-control"
                          aria-label={`Label description ${index + 1}: ${acceptedField.label}`}
                          value={rowField.label}
                          disabled={rowDisabled}
                          onChange={(event) =>
                            setWorkingField((current) => ({
                              ...current,
                              label: event.target.value
                            }))
                          }
                        />
                        {rowField.category === "Number" ? (
                          <label className="dcms-field-unit-control">
                            <small>Unit</small>
                            <input
                              aria-label={`Entered value unit ${index + 1}: ${acceptedField.label}`}
                              value={rowField.unit ?? ""}
                              placeholder="e.g., °F"
                              disabled={rowDisabled}
                              onChange={(event) =>
                                setWorkingField((current) => ({
                                  ...current,
                                  unit: event.target.value.trim()
                                    ? event.target.value
                                    : undefined
                                }))
                              }
                            />
                          </label>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {isEditing && optionsAllowed(rowField) ? (
                        <div className="dcms-inline-options-editor">
                          {rowField.options.map((option, optionIndex) => (
                            <div key={`${rowField.id}-option-${optionIndex}`}>
                              <input
                                aria-label={`Option ${optionIndex + 1} for field ${index + 1}`}
                                value={option}
                                disabled={validationDialogOpen}
                                onChange={(event) =>
                                  setWorkingField((current) => {
                                    const options = [...current.options];
                                    options[optionIndex] = event.target.value;
                                    return { ...current, options };
                                  })
                                }
                              />
                              <button
                                type="button"
                                aria-label={`Delete option ${optionIndex + 1} for field ${index + 1}`}
                                disabled={
                                  validationDialogOpen ||
                                  rowField.options.length <= 1
                                }
                                onClick={() =>
                                  setWorkingField((current) => ({
                                    ...current,
                                    options: current.options.filter(
                                      (_, currentIndex) =>
                                        currentIndex !== optionIndex
                                    )
                                  }))
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            aria-label={`Add option for field ${index + 1}`}
                            disabled={validationDialogOpen}
                            onClick={() =>
                              setWorkingField((current) => ({
                                ...current,
                                options: [
                                  ...current.options,
                                  `Option ${current.options.length + 1}`
                                ]
                              }))
                            }
                          >
                            + Option
                          </button>
                        </div>
                      ) : (
                        <input
                          className="dcms-field-options-control"
                          aria-label={`Options ${index + 1}: ${acceptedField.label}`}
                          value={optionSummary(rowField)}
                          disabled
                          readOnly
                        />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="dcms-validation-rule-action"
                        aria-label={`Edit validation rules for field ${index + 1}: ${acceptedField.label}`}
                        title={
                          isEditing
                            ? "Open validation-rule editor"
                            : "Click Edit to change validation rules"
                        }
                        disabled={rowDisabled}
                        onClick={(event) =>
                          openValidationEditor(event.currentTarget)
                        }
                      >
                        + Validation Rule ({rowField.validationRows.length})
                      </button>
                      {showAcceptedRecordContext ? (
                        <small
                          className="dcms-field-status"
                          data-validation-state={
                            acceptedContext?.validationState ?? "not_evaluated"
                          }
                        >
                          {acceptedContext?.validationText ?? "Not evaluated"}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <label className="dcms-must-correct-control">
                        <input
                          aria-label={`Must Be Correct field ${index + 1}: ${acceptedField.label}`}
                          type="checkbox"
                          checked={rowField.mustBeCorrect}
                          disabled={rowDisabled}
                          onChange={(event) =>
                            setWorkingField((current) => ({
                              ...current,
                              mustBeCorrect: event.target.checked
                            }))
                          }
                        />
                        <span>Yes</span>
                      </label>
                    </td>
                    {showAcceptedRecordContext ? (
                      <td>
                        <output
                          className="dcms-field-value"
                          aria-label={`Accepted Record value for ${acceptedField.label}`}
                          title={acceptedContext?.valueText ?? "Blank"}
                        >
                          {acceptedContext?.valueText ?? "Blank"}
                        </output>
                      </td>
                    ) : null}
                    <td className="dcms-field-action-cell">
                      <div className="dcms-field-actions">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="dcms-field-confirm-action"
                              aria-label={`Confirm field ${index + 1}: ${acceptedField.label}`}
                              title="Confirm field"
                              disabled={validationDialogOpen}
                              onClick={confirmRowEditor}
                            >
                              <span aria-hidden="true">✓</span>
                            </button>
                            <button
                              type="button"
                              className="dcms-field-cancel-action"
                              aria-label={`Cancel field ${index + 1}: ${acceptedField.label}`}
                              title="Cancel field"
                              disabled={validationDialogOpen}
                              onClick={closeRowEditor}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="dcms-field-edit-action"
                              aria-label={`Edit field ${index + 1}: ${acceptedField.label}`}
                              title={
                                disabled
                                  ? (disabledReason ??
                                    "Finish the active authoring edit first")
                                  : "Edit"
                              }
                              disabled={otherRowLocked}
                              onClick={(event) =>
                                openRowEditor(
                                  acceptedField,
                                  event.currentTarget
                                )
                              }
                            >
                              <span aria-hidden="true">✎</span>
                            </button>
                            <button
                              type="button"
                              className="dcms-field-delete-action"
                              aria-label={`Delete field ${index + 1}: ${acceptedField.label}`}
                              title="Delete"
                              disabled={
                                authoringLocked || model.fields.length <= 1
                              }
                              onClick={() => {
                                try {
                                  apply(
                                    deleteWorkbenchField(
                                      model,
                                      acceptedField.id
                                    )
                                  );
                                } catch (caught) {
                                  setErrorState({
                                    formId: model.formId,
                                    formVersion: model.formVersion,
                                    message:
                                      caught instanceof Error
                                        ? caught.message
                                        : String(caught)
                                  });
                                }
                              }}
                            >
                              <span aria-hidden="true">▣</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          aria-label="Add field"
          disabled={authoringLocked}
          onClick={() => apply(addWorkbenchField(model))}
        >
          + Add Row
        </button>

        {error ? <p role="alert">{error}</p> : null}
      </div>

      {editingField && validationDialogOpen ? (
        <ValidationRowEditor
          field={editingField}
          rulesOnly
          onCancel={() => setValidationDialogOpen(false)}
          onConfirm={(next) => {
            setWorkingField(() => next);
            setValidationDialogOpen(false);
            return { accepted: true };
          }}
          onDeleteRules={(next) => {
            setWorkingField(() => next);
            setValidationDialogOpen(false);
            return { accepted: true };
          }}
        />
      ) : null}
    </section>
  );
}
