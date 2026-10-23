/** Record-entry controls and rule-derived feedback for Workbench fields. */
import { useEffect, useId, useRef } from "react";
import type {
  DcmsValue,
  FieldEvaluation,
  RecordEvaluation
} from "@dcms/form-rules";
import { normalizeFiniteNumberInput } from "./normalization.js";
import type { WorkbenchFieldModel } from "./workbench-model.js";

export interface FieldFeedbackProps {
  result?: FieldEvaluation;
  id?: string;
}

function feedbackMessage(result: FieldEvaluation | undefined) {
  if (!result) return "Not evaluated";
  if (result.evaluationState === "error") {
    return result.evaluationErrors[0] ?? "Evaluation error";
  }
  if (result.validationState === "blocking") {
    return result.failures[0] ?? "Validation blocks Submit";
  }
  if (result.validationState === "warning") {
    return result.warnings[0] ?? result.failures[0] ?? "Validation warning";
  }
  if (result.validationState === "valid") return "Valid";
  return "No validation applied";
}

function fieldIsInvalid(result: FieldEvaluation | undefined) {
  return (
    result?.evaluationState === "error" ||
    result?.validationState === "blocking"
  );
}

function feedbackImportance(result: FieldEvaluation | undefined) {
  return result?.evaluationState === "error" ||
    result?.validationState === "blocking" ||
    result?.validationState === "warning"
    ? "persistent"
    : "routine";
}

/**
 * Render the engine result for one field.
 *
 * This component only explains derived rule state. It never decides whether a
 * server transition is allowed.
 */
export function FieldFeedback({ result, id }: FieldFeedbackProps) {
  const state =
    result?.evaluationState === "error"
      ? "error"
      : (result?.validationState ?? "not_evaluated");
  return (
    <div
      id={id}
      className="dcms-field-feedback"
      data-validation-state={state}
      data-feedback-importance={feedbackImportance(result)}
      aria-live="polite"
    >
      <span className="dcms-field-feedback-status">
        {feedbackMessage(result)}
      </span>
      {result?.inputGuidance.display ? (
        <small className="dcms-field-guidance">
          {result.inputGuidance.display}
        </small>
      ) : null}
    </div>
  );
}

export interface RecordFieldProps {
  field: WorkbenchFieldModel;
  value: DcmsValue | undefined;
  result?: FieldEvaluation;
  onChange(value: DcmsValue): void;
  onFocus?(): void;
  selected?: boolean;
}

function selectedValues(value: DcmsValue | undefined) {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Render the input control that matches one Workbench field category. */
export function RecordField({
  field,
  value,
  result,
  onChange,
  onFocus,
  selected = false
}: RecordFieldProps) {
  const instanceId = useId().replace(/:/g, "");
  const inputId = `dcms-record-${instanceId}-${field.id}`;
  const feedbackId = `${inputId}-feedback`;
  const invalid = fieldIsInvalid(result);

  let control;
  if (field.category === "Number") {
    control = (
      <label htmlFor={inputId}>
        {field.label}
        <span className="dcms-number-input-row">
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            aria-describedby={feedbackId}
            aria-invalid={invalid || undefined}
            value={value == null ? "" : String(value)}
            onFocus={onFocus}
            onChange={(event) =>
              onChange(normalizeFiniteNumberInput(event.target.value))
            }
          />
          {field.unit ? (
            <>
              <span className="dcms-input-unit" aria-hidden="true">
                {field.unit}
              </span>
              <span className="sr-only">Unit {field.unit}</span>
            </>
          ) : null}
        </span>
      </label>
    );
  } else if (field.category === "Radio") {
    const scalar = value == null ? "" : String(value);
    control = (
      <fieldset
        aria-describedby={feedbackId}
        aria-invalid={invalid || undefined}
      >
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={`${inputId}-group`}
              value={option}
              checked={scalar === option}
              onFocus={onFocus}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </fieldset>
    );
  } else if (field.category === "Checkbox") {
    const selected = selectedValues(value);
    control = (
      <fieldset
        aria-describedby={feedbackId}
        aria-invalid={invalid || undefined}
      >
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              value={option}
              checked={selected.includes(option)}
              onFocus={onFocus}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option]
                  : selected.filter((item) => item !== option);
                onChange(next);
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>
    );
  } else if (field.category === "Rich Text") {
    control = (
      <RichTextFieldControl
        inputId={inputId}
        feedbackId={feedbackId}
        label={field.label}
        value={value}
        invalid={invalid}
        onFocus={onFocus}
        onChange={onChange}
      />
    );
  } else {
    control = (
      <label htmlFor={inputId}>
        {field.label}
        <input
          id={inputId}
          type="text"
          aria-describedby={feedbackId}
          aria-invalid={invalid || undefined}
          value={value == null ? "" : String(value)}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <div
      className="dcms-record-field"
      data-field-id={field.id}
      data-field-category={field.category}
      data-selected={selected ? "true" : "false"}
    >
      {control}
      <FieldFeedback id={feedbackId} result={result} />
    </div>
  );
}

interface RichTextFieldControlProps {
  inputId: string;
  feedbackId: string;
  label: string;
  value: DcmsValue | undefined;
  invalid: boolean;
  onFocus?(): void;
  onChange(value: DcmsValue): void;
}

/**
 * Keep the reference contenteditable control synchronized with external state.
 *
 * Draft restore and seed import can replace Record values without a browser
 * input event. Updating innerText here keeps the visible editor and the store
 * on the same accepted value. Production Lexical serialization is a separate
 * DCMS integration boundary.
 */
function RichTextFieldControl({
  inputId,
  feedbackId,
  label,
  value,
  invalid,
  onFocus,
  onChange
}: RichTextFieldControlProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const text = value == null ? "" : String(value);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerText !== text) editor.innerText = text;
  }, [text]);

  return (
    <label htmlFor={inputId}>
      {label}
      <div
        ref={editorRef}
        id={inputId}
        className="dcms-rich-text-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-describedby={feedbackId}
        aria-invalid={invalid || undefined}
        onFocus={onFocus}
        onInput={(event) => onChange(event.currentTarget.innerText)}
      />
      <small>
        Reference-compatible contenteditable development control. Production
        Lexical serialization remains a DCMS host boundary.
      </small>
    </label>
  );
}

export interface RecordFormProps {
  fields: readonly WorkbenchFieldModel[];
  values: ReadonlyMap<string, DcmsValue>;
  evaluation: RecordEvaluation | null;
  onValueChange(fieldId: string, value: DcmsValue): void;
  onFieldFocus?(fieldId: string): void;
  selectedFieldId?: string | null;
}

/**
 * Render a complete Record surface from source values plus engine evaluation.
 *
 * Values come from the host/store. Feedback comes from @dcms/form-rules. The
 * component does not persist values or make workflow decisions.
 */
export function RecordForm({
  fields,
  values,
  evaluation,
  onValueChange,
  onFieldFocus,
  selectedFieldId = null
}: RecordFormProps) {
  const submitMessage = evaluation
    ? evaluation.canSubmit
      ? "Rules permit Submit"
      : "Rules block Submit"
    : "Rules not evaluated";

  return (
    <section className="dcms-record-form" aria-label="Record form">
      {fields.map((field) => (
        <RecordField
          key={field.id}
          field={field}
          value={values.get(field.id)}
          result={evaluation?.values.get(field.id)}
          onChange={(value) => onValueChange(field.id, value)}
          onFocus={() => onFieldFocus?.(field.id)}
          selected={selectedFieldId === field.id}
        />
      ))}
      <p role="status" aria-live="polite" data-testid="record-form-status">
        {submitMessage}
      </p>
    </section>
  );
}
