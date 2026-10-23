/**
 * Stress and edge-case performance characterization.
 *
 * Why this exists: normal DCMS entry is already fast, so the release decision also needs evidence near controlled
 * definition limits, on unusually long text, and under high dependency fan-out/depth. These measurements are
 * characterization data, not new product limits. Correctness is asserted; timing is reported without silently
 * turning one machine's timing into a universal SLA.
 */
import { performance } from "node:perf_hooks";
import {
  FORMULA_LIMITS,
  KEYWORD_LIMITS,
  affectedFields,
  compileForm,
  evaluateChange,
  evaluateKeyword,
  evaluatePreparedFormula,
  evaluateRecord,
  parseKeywordExpressionDetailed,
  prepareFormula
} from "../dist/esm/index.js";

function stats(samples) {
  const a = [...samples].sort((x, y) => x - y);
  const pick = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  return {
    n: a.length,
    mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(6),
    p50: +pick(0.5).toFixed(6),
    p95: +pick(0.95).toFixed(6),
    max: +a[a.length - 1].toFixed(6)
  };
}

function timed(fn, iterations, warmups = Math.min(3, iterations)) {
  for (let i = 0; i < warmups; i++) fn();
  const samples = [];
  let last;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    last = fn();
    samples.push(performance.now() - t0);
  }
  return { stats: stats(samples), last };
}

function balancedAdd(leaves) {
  if (leaves === 1) return "1";
  const left = Math.floor(leaves / 2);
  return `(${balancedAdd(left)}+${balancedAdd(leaves - left)})`;
}

function countKeywordNodes(node) {
  if (node.kind === "term") return 1;
  if (node.kind === "not") return 1 + countKeywordNodes(node.value);
  return 1 + countKeywordNodes(node.left) + countKeywordNodes(node.right);
}

function makeKeywordStressExpression(termLength = 55, termCount = 255) {
  const terms = [];
  for (let i = 0; i < termCount; i++) {
    const prefix = `TERM-${String(i).padStart(3, "0")}-`;
    terms.push(
      `${prefix}${"X".repeat(Math.max(1, termLength - prefix.length))}`
    );
  }
  return { terms, expression: terms.map((t) => `"${t}"`).join(" OR ") };
}

function formulaCase(
  name,
  source,
  expectedValue,
  prepareIterations,
  evaluationIterations
) {
  const prep = timed(() => prepareFormula(source), prepareIterations);
  const prepared = prep.last;
  const evaluation = timed(
    () =>
      evaluatePreparedFormula(prepared, { value: null, references: new Map() }),
    evaluationIterations
  );
  const actual = evaluation.last;
  if (actual !== expectedValue)
    throw new Error(`${name}: expected ${expectedValue}, got ${actual}`);
  return {
    name,
    sourceLength: source.length,
    preparedNodeCount: prepared.nodeCount,
    prepareMs: prep.stats,
    evaluationMs: evaluation.stats,
    expectedValue
  };
}

const formulaCases = [];
const nearMaxAstFormula = `=${balancedAdd(2048)}`;
formulaCases.push(
  formulaCase(
    "Near maximum source length + prepared AST nodes",
    nearMaxAstFormula,
    2048,
    20,
    500
  )
);
const maxDepthFormula = `=${"NOT ".repeat(127)}TRUE`;
formulaCases.push(
  formulaCase(
    "Maximum allowed prepared expression depth",
    maxDepthFormula,
    false,
    30,
    1000
  )
);
const maxParenFormula = `=${"(".repeat(64)}1${")".repeat(64)}`;
formulaCases.push(
  formulaCase(
    "Maximum allowed parenthesis nesting",
    maxParenFormula,
    1,
    30,
    1000
  )
);
const maxArgsFormula = `=SUM(${Array(255).fill("1").join(",")})`;
formulaCases.push(
  formulaCase(
    "Maximum allowed function arguments",
    maxArgsFormula,
    255,
    30,
    500
  )
);

if (nearMaxAstFormula.length > FORMULA_LIMITS.maxSourceLength)
  throw new Error("Near-limit formula exceeded source ceiling.");
if (formulaCases[0].preparedNodeCount !== FORMULA_LIMITS.maxAstNodes - 1)
  throw new Error("Near-limit AST case is not one node below the ceiling.");

const { terms: keywordTerms, expression: keywordExpression } =
  makeKeywordStressExpression();
if (keywordExpression.length > KEYWORD_LIMITS.maxExpressionLength)
  throw new Error("Keyword stress expression exceeds controlled limit.");
const keywordParse = timed(
  () => parseKeywordExpressionDetailed(keywordExpression),
  30
);
const keywordAst = keywordParse.last.ast;
const keywordNodeCount = countKeywordNodes(keywordAst);
if (keywordNodeCount > KEYWORD_LIMITS.maxAstNodes)
  throw new Error("Keyword stress AST exceeded controlled limit.");

const keywordTextCases = [];
for (const length of [10_000, 100_000, 1_000_000, 5_000_000]) {
  for (const matchPosition of ["none", "last"]) {
    const suffix = matchPosition === "last" ? ` ${keywordTerms.at(-1)}` : "";
    const text = `${"z".repeat(length)}${suffix}`;
    const iterations = length <= 100_000 ? 20 : length <= 1_000_000 ? 8 : 3;
    const measured = timed(
      () => evaluateKeyword(keywordAst, text, false),
      iterations,
      1
    );
    const expected = matchPosition === "last";
    if (measured.last !== expected)
      throw new Error(`Keyword ${length}/${matchPosition}: incorrect result.`);
    keywordTextCases.push({
      textLength: text.length,
      matchPosition,
      evaluationMs: measured.stats
    });
  }
}

// End-to-end field evaluation with the same near-limit Required Keywords definition.
const longTextDefinition = {
  formId: "stress-long-text",
  version: 1,
  fields: [
    {
      id: "narrative",
      label: "Narrative",
      valueType: "string",
      mustBeCorrect: true,
      validationRows: [
        {
          id: "narrative_keywords",
          operator: "AND",
          expression: null,
          criteria: "required_keywords",
          keyword: keywordExpression,
          caseSensitive: false
        }
      ]
    }
  ]
};
const longTextCompile = timed(() => compileForm(longTextDefinition), 15);
const longTextPlan = longTextCompile.last;
const longTextRecordCases = [];
for (const length of [10_000, 100_000, 1_000_000, 5_000_000]) {
  const values = new Map([
    ["narrative", `${"z".repeat(length)} ${keywordTerms.at(-1)}`]
  ]);
  let result = evaluateRecord(longTextPlan, values);
  if (!result.canSubmit)
    throw new Error(`Long-text ${length}: expected initial valid result.`);
  const iterations = length <= 100_000 ? 20 : length <= 1_000_000 ? 8 : 3;
  const measured = timed(
    () => {
      result = evaluateChange(longTextPlan, values, result, "narrative");
      return result;
    },
    iterations,
    1
  );
  if (!measured.last.canSubmit)
    throw new Error(`Long-text ${length}: expected valid incremental result.`);
  longTextRecordCases.push({
    textLength: values.get("narrative").length,
    incrementalMs: measured.stats
  });
}

function fanoutDefinition(fieldCount) {
  const fields = [
    {
      id: "root",
      label: "Root",
      valueType: "number",
      mustBeCorrect: false,
      validationRows: []
    }
  ];
  for (let i = 1; i < fieldCount; i++) {
    fields.push({
      id: `f${i}`,
      label: `Field ${i}`,
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [
        {
          id: `r${i}`,
          operator: "AND",
          expression: '=VALUE + FIELD("root") * 0',
          criteria: "number_greater_than",
          keyword: -1
        }
      ]
    });
  }
  return { formId: `fanout-${fieldCount}`, version: 1, fields };
}

function dependencyFanoutCase(fieldCount) {
  const def = fanoutDefinition(fieldCount);
  const compile = timed(() => compileForm(def), 5, 1);
  const plan = compile.last;
  const values = new Map(def.fields.map((f, i) => [f.id, i]));
  let result = evaluateRecord(plan, values);
  const affected = affectedFields(plan, "root").size;
  const measured = timed(
    () => {
      values.set("root", Number(values.get("root")) + 1);
      result = evaluateChange(plan, values, result, "root");
      return result;
    },
    fieldCount <= 100 ? 50 : 30,
    2
  );
  if (!measured.last.canSubmit)
    throw new Error(`Fan-out ${fieldCount}: unexpected blocking result.`);
  return {
    fieldCount,
    affectedFields: affected,
    compileMs: compile.stats,
    incrementalMs: measured.stats
  };
}

function chainDefinition(fieldCount) {
  const fields = [];
  for (let i = 0; i < fieldCount; i++) {
    fields.push({
      id: `f${i}`,
      label: `Field ${i}`,
      valueType: "number",
      expression: i === 0 ? null : `=FIELD("f${i - 1}") + 1`,
      mustBeCorrect: false,
      validations: []
    });
  }
  return { formId: `chain-${fieldCount}`, version: 1, fields };
}

function dependencyChainCase(fieldCount) {
  const def = chainDefinition(fieldCount);
  const compile = timed(() => compileForm(def), 3, 1);
  const plan = compile.last;
  const values = new Map(def.fields.map((f, i) => [f.id, i === 0 ? 1 : 0]));
  const full = timed(
    () => evaluateRecord(plan, values),
    fieldCount <= 100 ? 20 : 5,
    1
  );
  let result = full.last;
  const measured = timed(
    () => {
      values.set("f0", Number(values.get("f0")) + 1);
      result = evaluateChange(plan, values, result, "f0");
      return result;
    },
    fieldCount <= 100 ? 20 : fieldCount <= 500 ? 10 : 6,
    1
  );
  const lastValue = measured.last.values.get(
    `f${fieldCount - 1}`
  ).calculatedValue;
  return {
    fieldCount,
    affectedFields: affectedFields(plan, "f0").size,
    compileMs: compile.stats,
    fullEvaluationMs: full.stats,
    incrementalMs: measured.stats,
    finalCalculatedValue: lastValue
  };
}

const dependencyFanout = [
  dependencyFanoutCase(100),
  dependencyFanoutCase(1000)
];
const dependencyDepth = [
  dependencyChainCase(100),
  dependencyChainCase(500),
  dependencyChainCase(1000)
];

function outputProbe(name, formula, expectedShape, iterations) {
  const prepared = prepareFormula(formula);
  const measured = timed(
    () =>
      evaluatePreparedFormula(prepared, { value: null, references: new Map() }),
    iterations,
    1
  );
  const value = measured.last;
  const shape = Array.isArray(value)
    ? {
        kind: "array",
        rows: value.length,
        columns: Array.isArray(value[0]) ? value[0].length : null
      }
    : {
        kind: typeof value,
        length: typeof value === "string" ? value.length : null
      };
  if (JSON.stringify(shape) !== JSON.stringify(expectedShape))
    throw new Error(
      `${name}: unexpected output shape ${JSON.stringify(shape)}`
    );
  return { name, formula, output: shape, evaluationMs: measured.stats };
}

const outputProbes = [
  outputProbe(
    "Formula.js large text output",
    '=REPT("XXXXXXXXXX",100000)',
    { kind: "string", length: 1_000_000 },
    8
  ),
  outputProbe(
    "Formula.js matrix output 90x90",
    "=MUNIT(90)",
    { kind: "array", rows: 90, columns: 90 },
    5
  )
];
const rejectedOutputs = [
  '=REPT("X",2000000)',
  "=MUNIT(250)",
  "=MUNIT(500)"
].map((formula) => {
  const start = performance.now();
  let code;
  try {
    evaluatePreparedFormula(prepareFormula(formula), {
      value: null,
      references: new Map()
    });
  } catch (error) {
    code = error.code;
  }
  if (code !== "FORMULA_LIMIT_EXCEEDED")
    throw new Error(
      `Expected a controlled output limit for ${formula}, received ${code}`
    );
  return { formula, code, elapsedMs: performance.now() - start };
});

const report = {
  benchmark: "DCMS form-rules stress and edge-case characterization",
  packageVersion: "0.10.1",
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  generatedAt: new Date().toISOString(),
  limits: { formula: FORMULA_LIMITS, requiredKeywords: KEYWORD_LIMITS },
  formulaCases,
  requiredKeywords: {
    expressionLength: keywordExpression.length,
    astNodeCount: keywordNodeCount,
    parseMs: keywordParse.stats,
    longTextDirectEvaluation: keywordTextCases,
    formCompileMs: longTextCompile.stats,
    longTextIncrementalEvaluation: longTextRecordCases
  },
  dependencyFanout,
  dependencyDepth,
  formulaJsOutputProbes: outputProbes,
  rejectedOutputs,
  interpretation: {
    timingPolicy:
      "Characterization only; timings from this machine are not a product SLA.",
    outputLimitNote:
      "Output-size limits reject large text/matrices before known allocations; workers remain necessary to preempt expensive third-party computation."
  }
};

console.log(JSON.stringify(report, null, 2));
