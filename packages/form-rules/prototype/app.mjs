/** Reference browser integration for the package; demonstrates package APIs rather than a second rules implementation. */
import {
  compileForm,
  evaluateRecord,
  evaluateChange,
  affectedFields,
  getCompiledPlanStats
} from "../dist/esm/index.js";
import {
  buildPrototypeDefinition,
  buildInitialValues,
  buildAllValidValues,
  valuesMapToObject
} from "./form-definition.mjs";

const { definition, meta } = buildPrototypeDefinition();
const compileStart = performance.now();
const plan = compileForm(definition);
const compileMs = performance.now() - compileStart;
const stats = getCompiledPlanStats(plan);
let entered = buildInitialValues(meta);
let evaluation = evaluateRecord(plan, entered);
let eventCount = 0,
  evalTotalMs = 0,
  lastEvalMs = 0,
  lastImpacted = 100;

const rows = document.querySelector("#rows");
const metrics = document.querySelector("#metrics");
const message = document.querySelector("#message");
const rowEls = new Map();

function fmt(v) {
  return typeof v === "number"
    ? Number.isInteger(v)
      ? String(v)
      : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
    : String(v ?? "");
}
function fieldStatus(id) {
  const v = evaluation.values.get(id);
  if (v.blocking) return ["blocking", "FAIL — blocks Submit"];
  if (!v.validationPassed) return ["warning", "WARNING — Save/Submit allowed"];
  return ["pass", "PASS"];
}
function validationLines(f) {
  return f.validations.map(
    (r, i) =>
      `${i + 1}. ${r.criteria.replaceAll("_", " ")} ${Array.isArray(r.keyword) ? r.keyword.join(", ") : r.keyword}`
  );
}

function renderRows() {
  rows.innerHTML = "";
  rowEls.clear();
  definition.fields.forEach((f, i) => {
    const m = meta.get(f.id),
      v = evaluation.values.get(f.id),
      [state, label] = fieldStatus(f.id);
    const tr = document.createElement("tr");
    tr.dataset.id = f.id;
    if (state === "blocking") tr.className = "blocking";
    else if (state === "warning") tr.className = "warning";
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${f.label}</strong><br><small>${m.inputUnit} → ${m.outputUnit}</small></td>
      <td><input type="number" step="any" value="${entered.get(f.id)}" data-field="${f.id}" aria-label="${f.label}"></td>
      <td><div class="formula">${f.expression}</div><div class="calc" data-calc>${fmt(v.calculatedValue)} ${m.outputUnit}</div></td>
      <td><span class="badge ${f.mustBeCorrect ? "strict" : "warn"}">${f.mustBeCorrect ? "Yes — strict" : "No — warning"}</span></td>
      <td><details><summary>10 rules</summary><ul>${validationLines(f)
        .map((x) => `<li>${x}</li>`)
        .join("")}</ul></details></td>
      <td data-status class="${state === "pass" ? "status-pass" : state === "blocking" ? "status-fail" : "status-warning"}">${label}</td>`;
    rows.appendChild(tr);
    rowEls.set(f.id, tr);
  });
}

function updateRows(ids) {
  for (const id of ids) {
    const tr = rowEls.get(id);
    if (!tr) continue;
    const v = evaluation.values.get(id),
      m = meta.get(id),
      [state, label] = fieldStatus(id);
    tr.className =
      state === "blocking" ? "blocking" : state === "warning" ? "warning" : "";
    tr.querySelector("[data-calc]").textContent =
      `${fmt(v.calculatedValue)} ${m.outputUnit}`;
    const status = tr.querySelector("[data-status]");
    status.textContent = label;
    status.className =
      state === "pass"
        ? "status-pass"
        : state === "blocking"
          ? "status-fail"
          : "status-warning";
  }
}

function renderMetrics() {
  metrics.innerHTML = [
    ["Fields", stats.fieldCount],
    ["Compiled formulas", stats.formulaCount],
    ["Validation rows", stats.validationRuleCount],
    ["Instruction cells", stats.formulaInstructionCells],
    ["Compile time", `${compileMs.toFixed(2)} ms`],
    ["Last key evaluation", `${lastEvalMs.toFixed(3)} ms`],
    [
      "Mean key evaluation",
      eventCount ? `${(evalTotalMs / eventCount).toFixed(3)} ms` : "—"
    ],
    ["Fields affected last key", lastImpacted],
    ["Strict failures", evaluation.blockingFieldIds.length],
    ["Warning-only failures", evaluation.warningFieldIds.length],
    ["Draft Save", "Allowed"],
    ["Submit", evaluation.canSubmit ? "Allowed" : "Blocked"]
  ]
    .map(
      ([k, v]) =>
        `<div class="metric"><div class="v">${v}</div><div class="k">${k}</div></div>`
    )
    .join("");
}

rows.addEventListener("input", (e) => {
  const input = e.target.closest("input[data-field]");
  if (!input) return;
  const id = input.dataset.field;
  const raw = input.value;
  entered.set(id, raw === "" ? null : Number(raw));
  const impacted = affectedFields(plan, id);
  const t = performance.now();
  evaluation = evaluateChange(plan, entered, evaluation, id);
  lastEvalMs = performance.now() - t;
  eventCount++;
  evalTotalMs += lastEvalMs;
  lastImpacted = impacted.size;
  updateRows(impacted);
  renderMetrics();
  message.className = "message";
  message.textContent = "";
});

async function post(path) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: valuesMapToObject(entered) })
  });
  const data = await response.json();
  return { response, data };
}

document.querySelector("#saveBtn").addEventListener("click", async () => {
  localStorage.setItem(
    "dcms-prototype-draft",
    JSON.stringify(valuesMapToObject(entered))
  );
  const { response, data } = await post("/api/save");
  message.className = "message " + (response.ok ? "ok" : "bad");
  message.textContent = response.ok
    ? `Draft saved. Server also re-evaluated all 1,000 rules. Strict failures: ${data.blockingCount}; warning-only failures: ${data.warningCount}. Invalid data is allowed in Draft Save.`
    : `Save error: ${data.error ?? response.statusText}`;
});

document.querySelector("#submitBtn").addEventListener("click", async () => {
  const { response, data } = await post("/api/submit");
  if (response.ok) {
    message.className = "message ok";
    message.textContent = `Submitted. Server authoritative validation passed. Warning-only failures retained: ${data.warningCount}.`;
  } else {
    message.className = "message bad";
    message.textContent = `Submit blocked by ${data.blockingCount} Must Be Correct field(s): ${data.blockingFieldIds.slice(0, 8).join(", ")}${data.blockingCount > 8 ? "…" : ""}`;
  }
});

document.querySelector("#makeValid").addEventListener("click", () => {
  entered = buildAllValidValues(meta);
  evaluation = evaluateRecord(plan, entered);
  lastImpacted = 100;
  renderRows();
  renderMetrics();
  message.className = "message ok";
  message.textContent =
    "All sample values moved into the valid range. Submit should now be allowed.";
});
document.querySelector("#resetFailures").addEventListener("click", () => {
  entered = buildInitialValues(meta);
  evaluation = evaluateRecord(plan, entered);
  lastImpacted = 100;
  renderRows();
  renderMetrics();
  message.className = "message warn";
  message.textContent =
    "Sample failures restored. Draft Save remains allowed; Submit is blocked by strict failures.";
});

const saved = localStorage.getItem("dcms-prototype-draft");
if (saved) {
  try {
    const obj = JSON.parse(saved);
    for (const [k, v] of Object.entries(obj))
      if (meta.has(k)) entered.set(k, v);
    evaluation = evaluateRecord(plan, entered);
  } catch {}
}
renderRows();
renderMetrics();
message.className = "message warn";
message.textContent =
  "Prototype loaded with intentional failures. Edit any field to see incremental formula + validation processing.";
