/** Transactional field-row editor with validation-rule diagnostics. */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import type { RowOperator, ValidationRowDefinition } from "@dcms/form-rules";
import type { DefinitionUpdateResult } from "./workbench-store.js";
import type { WorkbenchFieldCategory } from "./contracts.js";
import {
  applyWorkbenchFieldCategory,
  cloneWorkbenchField
} from "./form-editor.js";
import type { WorkbenchFieldModel } from "./workbench-model.js";
import {
  cloneValidationRow,
  criteriaForWorkbenchCategory,
  getValidationRowDiagnostics,
  nextValidationRowId,
  summarizeValidationRows
} from "./validation-editor.js";

const FIELD_CATEGORIES: readonly WorkbenchFieldCategory[] = [
  "Radio",
  "Number",
  "Text",
  "Rich Text",
  "Checkbox"
];
const OPERATORS: readonly RowOperator[] = ["AND", "OR", "AND NOT", "OR NOT"];

function optionsAllowed(category: WorkbenchFieldCategory) {
  return category === "Radio" || category === "Checkbox";
}
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export interface ValidationRowEditorProps {
  field: WorkbenchFieldModel;
  onConfirm(field: WorkbenchFieldModel): DefinitionUpdateResult | void;
  onCancel(): void;
  onDeleteRules?(field: WorkbenchFieldModel): DefinitionUpdateResult | void;
  /** Restrict the modal to validation rows inside an existing field draft. */
  rulesOnly?: boolean;
}

function selectionText(row: ValidationRowDefinition) {
  return Array.isArray(row.keyword)
    ? row.keyword.join("\n")
    : String(row.keyword ?? "");
}

function visibleFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0
  );
}

/**
 * Edit one complete field row in a temporary working copy.
 *
 * Category, label, options, correctness, and validation rows share the same
 * proposal. Confirm proposes the edited field to the caller. Cancel discards
 * the copy, so an incomplete or rejected rule never mutates the accepted Form
 * model.
 */
export function ValidationRowEditor({
  field,
  onConfirm,
  onCancel,
  onDeleteRules,
  rulesOnly = false
}: ValidationRowEditorProps) {
  const [working, setWorking] = useState(() => cloneWorkbenchField(field));
  const [submitError, setSubmitError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const firstRuleControlRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const summaryId = useId();
  const transactionId = useId();

  useEffect(() => {
    setWorking(cloneWorkbenchField(field));
    setSubmitError("");
  }, [field]);

  useEffect(() => {
    if (rulesOnly) firstRuleControlRef.current?.focus();
    else firstControlRef.current?.focus();
  }, [field.id, rulesOnly]);

  const summary = useMemo(
    () => summarizeValidationRows(working.validationRows),
    [working.validationRows]
  );
  const isDirty = useMemo(
    () => JSON.stringify(working) !== JSON.stringify(field),
    [field, working]
  );
  const acceptanceLabel = rulesOnly ? "Apply rule changes" : "Confirm field";

  const updateRow = (
    index: number,
    update: (row: ValidationRowDefinition) => ValidationRowDefinition
  ) => {
    setWorking((current) => ({
      ...current,
      validationRows: current.validationRows.map((row, rowIndex) =>
        rowIndex === index ? update(cloneValidationRow(row)) : row
      )
    }));
    setSubmitError("");
  };

  const applyResult = (result: DefinitionUpdateResult | void) => {
    if (result && !result.accepted) {
      setSubmitError(result.error ?? "Definition was not accepted.");
      return false;
    }
    return true;
  };

  const confirm = () => {
    if (summary.blockingIssueCount > 0) return;
    applyResult(onConfirm(cloneWorkbenchField(working)));
  };

  const deleteRules = () => {
    const next = { ...cloneWorkbenchField(working), validationRows: [] };
    if (onDeleteRules) applyResult(onDeleteRules(next));
    else applyResult(onConfirm(next));
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = visibleFocusableElements(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section
      ref={dialogRef}
      className="dcms-validation-editor"
      data-rules-only={rulesOnly ? "true" : undefined}
      data-dirty={isDirty ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${transactionId} ${summaryId}`}
      onKeyDown={handleDialogKeyDown}
    >
      <header>
        <button
          type="button"
          onClick={onCancel}
          aria-label={
            rulesOnly
              ? "Discard validation-rule changes and return"
              : "Back without saving"
          }
        >
          ‹
        </button>
        <h2 id={titleId}>
          {rulesOnly
            ? `Validation Rules for ${field.label}${field.unit ? ` — entered in ${field.unit}` : ""}`
            : `Edit Field: ${field.label}`}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label={
            rulesOnly
              ? "Discard validation-rule changes and close"
              : "Close without saving"
          }
        >
          ×
        </button>
      </header>

      <div id={transactionId} className="dcms-validation-transaction-help">
        {rulesOnly ? (
          <p>
            <strong>Apply rule changes</strong> updates the detached field
            draft. Confirm the field row to accept that complete draft into the
            working Form.
          </p>
        ) : (
          <p>
            Confirm proposes this complete detached field draft to the caller.
            Cancel leaves the accepted Form unchanged.
          </p>
        )}
        <span data-testid="validation-dirty-state" data-dirty={isDirty}>
          {isDirty ? "Unsaved changes" : "No unsaved changes"}
        </span>
      </div>

      {!rulesOnly ? (
        <>
          <div className="dcms-validation-context">
            <label>
              Field Category
              <select
                ref={firstControlRef}
                aria-label="Field Category"
                value={working.category}
                onChange={(event) =>
                  setWorking((current) =>
                    applyWorkbenchFieldCategory(
                      current,
                      event.target.value as WorkbenchFieldCategory
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
            </label>
            <label>
              Label Description
              <input
                aria-label="Label Description"
                value={working.label}
                onChange={(event) =>
                  setWorking((current) => ({
                    ...current,
                    label: event.target.value
                  }))
                }
              />
            </label>
            <label className="dcms-field-correctness">
              Must Be Correct?
              <span>
                <input
                  aria-label="Must Be Correct"
                  type="checkbox"
                  checked={working.mustBeCorrect}
                  onChange={(event) =>
                    setWorking((current) => ({
                      ...current,
                      mustBeCorrect: event.target.checked
                    }))
                  }
                />
                Yes
              </span>
            </label>
          </div>

          {optionsAllowed(working.category) ? (
            <fieldset className="dcms-field-options-editor">
              <legend>{working.category} Options</legend>
              {working.options.map((option, optionIndex) => (
                <div key={`${working.id}-option-${optionIndex}`}>
                  <input
                    aria-label={`Option ${optionIndex + 1}`}
                    value={option}
                    onChange={(event) =>
                      setWorking((current) => {
                        const options = [...current.options];
                        options[optionIndex] = event.target.value;
                        return { ...current, options };
                      })
                    }
                  />
                  <button
                    type="button"
                    disabled={working.options.length <= 1}
                    aria-label={`Delete option ${optionIndex + 1}`}
                    onClick={() =>
                      setWorking((current) => ({
                        ...current,
                        options: current.options.filter(
                          (_, currentIndex) => currentIndex !== optionIndex
                        )
                      }))
                    }
                  >
                    Delete
                  </button>
                </div>
              ))}
              <button
                type="button"
                aria-label={`Add ${working.category} option`}
                onClick={() =>
                  setWorking((current) => ({
                    ...current,
                    options: [
                      ...current.options,
                      `Option ${current.options.length + 1}`
                    ]
                  }))
                }
              >
                + {working.category}
              </button>
            </fieldset>
          ) : null}
        </>
      ) : null}

      <h3 className="dcms-validation-rules-heading">Validation Rules</h3>
      <div className="dcms-validation-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Join</th>
              <th scope="col">Optional Expression</th>
              <th scope="col">Criteria</th>
              <th scope="col">Keyword / Values</th>
              <th scope="col">Case Sensitive</th>
              <th scope="col">Delete</th>
            </tr>
          </thead>
          <tbody>
            {working.validationRows.map((row, index) => {
              const diagnosis = getValidationRowDiagnostics(row);
              const selection = row.criteria.startsWith("selection_values_");
              const numeric =
                row.criteria.startsWith("number_") ||
                row.criteria.startsWith("character_limit_");
              return (
                <tr key={row.id} data-validation-row-id={row.id}>
                  <td>
                    {index === 0 ? (
                      <>
                        <span
                          className="dcms-validation-start"
                          aria-label="Start of validation expression"
                        >
                          START
                        </span>
                        <small>First rule starts the expression.</small>
                      </>
                    ) : (
                      <select
                        aria-label={`Join row ${index + 1}`}
                        value={row.operator ?? "AND"}
                        onChange={(event) =>
                          updateRow(index, (next) => ({
                            ...next,
                            operator: event.target.value as RowOperator
                          }))
                        }
                      >
                        {OPERATORS.map((operator) => (
                          <option key={operator}>{operator}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      ref={index === 0 ? firstRuleControlRef : undefined}
                      aria-label={`Optional expression row ${index + 1}`}
                      value={row.expression ?? ""}
                      onChange={(event) =>
                        updateRow(index, (next) => ({
                          ...next,
                          expression: event.target.value.trim()
                            ? event.target.value
                            : null
                        }))
                      }
                    />
                    <small data-state={diagnosis.formulaState}>
                      {diagnosis.formulaMessage}
                    </small>
                    {row.expression?.trim() ||
                    row.resultLabel ||
                    row.resultUnit ? (
                      <div className="dcms-validation-result-context">
                        <label>
                          <small>Calculated label</small>
                          <input
                            aria-label={`Calculated value label row ${index + 1}`}
                            value={row.resultLabel ?? ""}
                            placeholder="e.g., Converted temperature"
                            onChange={(event) =>
                              updateRow(index, (next) => ({
                                ...next,
                                resultLabel: event.target.value.trim()
                                  ? event.target.value
                                  : undefined
                              }))
                            }
                          />
                        </label>
                        <label className="dcms-validation-result-unit">
                          <small>Unit</small>
                          <input
                            aria-label={`Calculated value unit row ${index + 1}`}
                            value={row.resultUnit ?? ""}
                            placeholder="e.g., °C"
                            onChange={(event) =>
                              updateRow(index, (next) => ({
                                ...next,
                                resultUnit: event.target.value.trim()
                                  ? event.target.value
                                  : undefined
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <select
                      aria-label={`Criteria row ${index + 1}`}
                      value={row.criteria}
                      onChange={(event) =>
                        updateRow(index, (next) => {
                          const criteria = event.target
                            .value as ValidationRowDefinition["criteria"];
                          return {
                            ...next,
                            criteria,
                            keyword: criteria.startsWith("selection_values_")
                              ? Array.isArray(next.keyword)
                                ? next.keyword
                                : [String(next.keyword || "Pass")]
                              : next.keyword
                          };
                        })
                      }
                    >
                      {criteriaForWorkbenchCategory(working.category).map(
                        (item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        )
                      )}
                    </select>
                  </td>
                  <td>
                    {selection ? (
                      <textarea
                        aria-label={`Selection values row ${index + 1}`}
                        value={selectionText(row)}
                        onChange={(event) =>
                          updateRow(index, (next) => ({
                            ...next,
                            keyword: event.target.value
                              .split(/\r?\n/)
                              .map((value) => value.trim())
                              .filter(Boolean)
                          }))
                        }
                      />
                    ) : (
                      <input
                        aria-label={`Criterion value row ${index + 1}`}
                        value={
                          Array.isArray(row.keyword)
                            ? row.keyword.join("\n")
                            : String(row.keyword ?? "")
                        }
                        onChange={(event) =>
                          updateRow(index, (next) => {
                            if (!numeric) {
                              return { ...next, keyword: event.target.value };
                            }
                            if (event.target.value === "") {
                              return { ...next, keyword: "" };
                            }
                            const parsed = Number(event.target.value);
                            return {
                              ...next,
                              keyword: Number.isFinite(parsed)
                                ? parsed
                                : event.target.value
                            };
                          })
                        }
                      />
                    )}
                    <small data-state={diagnosis.criterionState}>
                      {diagnosis.criterionMessage}
                    </small>
                    <label className="dcms-validation-failure-message">
                      <small>Failure introduction (optional)</small>
                      <input
                        aria-label={`Friendly failure introduction row ${index + 1}`}
                        value={row.failureMessage ?? ""}
                        placeholder="The entered value is outside the allowed range."
                        onChange={(event) =>
                          updateRow(index, (next) => ({
                            ...next,
                            failureMessage: event.target.value.trim()
                              ? event.target.value
                              : undefined
                          }))
                        }
                      />
                    </label>
                  </td>
                  <td>
                    <input
                      aria-label={`Case sensitive row ${index + 1}`}
                      type="checkbox"
                      checked={!!row.caseSensitive}
                      onChange={(event) =>
                        updateRow(index, (next) => ({
                          ...next,
                          caseSensitive: event.target.checked
                        }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Delete row ${index + 1}`}
                      onClick={() => {
                        setWorking((current) => ({
                          ...current,
                          validationRows: current.validationRows.filter(
                            (_, rowIndex) => rowIndex !== index
                          )
                        }));
                        setSubmitError("");
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => {
          setWorking((current) => ({
            ...current,
            validationRows: [
              ...current.validationRows,
              {
                id: nextValidationRowId(current.id, current.validationRows),
                operator: "AND",
                criteria: "required_keywords",
                keyword: "PASS",
                caseSensitive: false
              }
            ]
          }));
          setSubmitError("");
        }}
      >
        + Add Row
      </button>

      <p
        id={summaryId}
        role="status"
        aria-live="polite"
        data-testid="validation-summary"
      >
        {summary.blockingIssueCount
          ? `${summary.blockingIssueCount} syntax or criterion issue(s) must be corrected before ${acceptanceLabel}.`
          : summary.warningCount
            ? `${summary.warningCount} non-blocking authoring warning(s).`
            : "Definition syntax is ready to compile."}
      </p>
      {submitError ? (
        <p role="alert">Definition rejected: {submitError}</p>
      ) : null}

      <footer>
        <button
          type="button"
          className="dcms-validation-delete-action"
          aria-label={`Delete all validation rules for ${field.label}`}
          onClick={deleteRules}
        >
          Delete rules
        </button>
        <button
          type="button"
          className="dcms-validation-cancel-action"
          aria-label={rulesOnly ? "Cancel changes" : "Cancel field changes"}
          onClick={onCancel}
        >
          × {rulesOnly ? "Cancel changes" : "Cancel field changes"}
        </button>
        <button
          type="button"
          className="dcms-validation-confirm-action"
          aria-label={acceptanceLabel}
          disabled={summary.blockingIssueCount > 0}
          aria-describedby={summaryId}
          onClick={confirm}
        >
          ✓ {acceptanceLabel}
        </button>
      </footer>
    </section>
  );
}
