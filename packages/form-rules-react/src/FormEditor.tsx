/** Controlled React Form-authoring surface for the Workbench model. */
import { useEffect, useRef, useState, type DragEvent } from "react";
import Select, { type StylesConfig } from "react-select";
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
  /**
   * Optional Value-column entry handler supplied by an application
   * composition.
   *
   * When provided, the Value column renders an editable control instead of
   * read-only evidence and reports every entry as text for the row's field
   * id. Selection categories (Radio/Checkbox) present that control as a
   * dropdown of the choices authored in the Options column — single choice
   * for Radio, multiple for Checkbox — and report the chosen values
   * comma-joined. The control is only editable while the row's own edit
   * session is open, matching the other columns; outside it the accepted
   * value stays rendered as read-only evidence.
   *
   * The editor never parses, normalizes or stores that text itself: the host
   * maps it to its Record value and feeds the resulting evaluation back
   * through acceptedRecordContext, so the cell, the stored value and the
   * validation status stay in sync on every change.
   */
  onValueChange?(fieldId: string, text: string): void;
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

type ValueOption = { readonly label: string; readonly value: string };

/** Options authored in the Options column, as dropdown choices. */
function valueOptions(field: WorkbenchFieldModel): ValueOption[] {
  return (field.options ?? []).map((option) => ({
    label: option,
    value: option
  }));
}

/** Deduplicated tokens of a comma-joined selection Value text. */
function selectionValueTokens(valueText: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of String(valueText ?? "").split(",")) {
    const text = part.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    tokens.push(text);
  }
  return tokens;
}

/**
 * Selected choices of a selection-category row, parsed from the accepted
 * Value text (selection values are stored comma-joined, the same text the
 * host persists). A token that is no longer in the Options column leaves the
 * Value dropdown together with the Options entry that removed it, so the two
 * columns never offer different choices; Confirm prunes it from the stored
 * value as well.
 */
function selectedValueOptions(
  field: WorkbenchFieldModel,
  valueText: string
): ValueOption[] {
  const known = new Map(
    valueOptions(field).map((option) => [option.value, option])
  );
  const selected: ValueOption[] = [];
  for (const text of selectionValueTokens(valueText)) {
    const option = known.get(text);
    if (option) selected.push(option);
  }
  return selected;
}

/** Options of a field, compared by authored content. */
function sameOptionList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((text, index) => text === right[index])
  );
}

/** Canonical Value text for the chosen dropdown options. */
function valueTextFromOptions(options: readonly ValueOption[]): string {
  return options.map((option) => option.value).join(", ");
}

/** Number cells accept digits and a single decimal point, nothing else. */
function sanitizeNumberValueText(text: string): string {
  const raw = String(text ?? "").replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = raw.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

function isNumberValueField(field: WorkbenchFieldModel) {
  return field.category === "Number";
}

/** Keep the dropdown above the authoring table (and its scroll container). */
const valueSelectStyles: StylesConfig<ValueOption, boolean> = {
  menuPortal: (base) => ({ ...base, zIndex: 1200 })
};

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
 * field once through onChange. Cancel discards the complete draft. The Value
 * column is read-only evidence unless the host wires onValueChange; even
 * then it only becomes editable while this row's own edit session is open.
 */
export function FormEditor({
  model,
  onChange,
  onEditingFieldChange,
  acceptedRecordContext,
  onValueChange,
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
  // The Value dropdowns render their menu in a portal so the table's own
  // scroll container (overflow) cannot clip them. SSR has no document, so the
  // menu falls back to in-place absolute positioning there.
  const menuPortalTarget =
    typeof document === "undefined" ? undefined : document.body;

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

  /**
   * Options removed (or renamed) in the Options column also leave the stored
   * Value as soon as the edit is applied: the dropdown already hides them,
   * and pruning the stored value here keeps the dropdown, the stored value
   * and the live evaluation in step. Only Confirm applies it, so Cancel keeps
   * the value that the restored options still describe.
   */
  const pruneRemovedOptionValues = (
    previous: WorkbenchFieldModel | undefined,
    next: WorkbenchFieldModel
  ) => {
    if (!onValueChange || !previous) return;
    if (
      !optionsAllowed(next) ||
      sameOptionList(previous.options, next.options)
    ) {
      return;
    }
    const previousText = acceptedRecordContext?.[next.id]?.valueText ?? "";
    if (!previousText || previousText === "Blank") return;
    const kept = selectedValueOptions(next, previousText);
    if (kept.length === selectionValueTokens(previousText).length) return;
    onValueChange(next.id, valueTextFromOptions(kept));
  };

  const confirmRowEditor = () => {
    if (!editingField) return;
    const previousField = acceptedEditingField;
    const result = apply(replaceWorkbenchField(model, editingField));
    if (!result.accepted) return;
    pruneRemovedOptionValues(previousField, editingField);
    closeRowEditor();
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
                // The Value control follows the row's current category —
                // including the open edit draft — so switching a row to
                // Radio or Checkbox turns its Value cell into a dropdown at
                // once, with the choices the Options column holds for that
                // draft. Radio stays single-choice, Checkbox multi-choice.
                // Like every other control it is only editable while this
                // row's edit session is open (rowDisabled).
                const valueField = rowField;
                const selectionValue = optionsAllowed(valueField)
                  ? selectedValueOptions(
                      valueField,
                      acceptedContext?.valueText ?? ""
                    )
                  : [];
                const selectionIsMulti =
                  valueField.category === "Checkbox";
                const selectionOptions = optionsAllowed(valueField)
                  ? valueOptions(valueField)
                  : [];
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
                        onChange={(event) => {
                          const category = event.target
                            .value as WorkbenchFieldModel["category"];
                          // The stored Value belongs to the previous
                          // category, so its input state resets together
                          // with the category change instead of carrying a
                          // value the new category cannot hold.
                          if (category !== rowField.category) {
                            onValueChange?.(acceptedField.id, "");
                          }
                          setWorkingField((current) =>
                            applyWorkbenchFieldCategory(current, category)
                          );
                        }}
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
                        {onValueChange ? (
                          optionsAllowed(valueField) ? (
                            <Select<ValueOption, boolean>
                              className="dcms-field-value-select"
                              classNamePrefix="dcms-select"
                              aria-label={`Record value for ${acceptedField.label}`}
                              options={selectionOptions}
                              value={
                                selectionIsMulti
                                  ? selectionValue
                                  : selectionValue[0] ?? null
                              }
                              isMulti={selectionIsMulti}
                              isClearable
                              isDisabled={rowDisabled}
                              placeholder="Blank"
                              menuPortalTarget={menuPortalTarget}
                              menuPosition={
                                menuPortalTarget ? "fixed" : "absolute"
                              }
                              styles={valueSelectStyles}
                              onChange={(selected) => {
                                const picked = Array.isArray(selected)
                                  ? selected
                                  : selected
                                    ? [selected]
                                    : [];
                                onValueChange(
                                  acceptedField.id,
                                  valueTextFromOptions(picked)
                                );
                              }}
                            />
                          ) : (
                            <input
                              className="dcms-field-value-input"
                              type="text"
                              inputMode={
                                isNumberValueField(valueField)
                                  ? "decimal"
                                  : undefined
                              }
                              aria-label={`Record value for ${acceptedField.label}`}
                              title={acceptedContext?.valueText ?? "Blank"}
                              placeholder="Blank"
                              value={acceptedContext?.valueText ?? ""}
                              disabled={rowDisabled}
                              onChange={(event) =>
                                onValueChange(
                                  acceptedField.id,
                                  isNumberValueField(valueField)
                                    ? sanitizeNumberValueText(
                                        event.target.value
                                      )
                                    : event.target.value
                                )
                              }
                            />
                          )
                        ) : (
                          <output
                            className="dcms-field-value"
                            aria-label={`Accepted Record value for ${acceptedField.label}`}
                            title={acceptedContext?.valueText ?? "Blank"}
                          >
                            {acceptedContext?.valueText ?? "Blank"}
                          </output>
                        )}
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
