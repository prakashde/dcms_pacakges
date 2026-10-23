/**
 * Conservative authoring-time conflict detection.
 *
 * This module deliberately recognizes only contradictions that can be proven from simple AND-composed rules.
 * It is not a second Boolean evaluator; uncertain cases are left to the normal compiled runtime so author intent
 * is never rejected based on an unsafe simplification.
 */
import type { ValidationRuleInput } from "./types.js";
import { isSelectionCriteria } from "./validation.js";

export interface RuleConflict {
  code: string;
  message: string;
  indexes: number[];
}

function values(rule: ValidationRuleInput): string[] {
  return (
    Array.isArray(rule.keyword) ? rule.keyword : [String(rule.keyword)]
  ).map(String);
}

/**
 * Find selected numeric, length and selection contradictions in a same-value AND group.
 * Caller must establish that precondition: this helper does not interpret OR/NOT operators
 * or compare different formula outputs. An empty result is not proof of satisfiability.
 */
export function findRuleConflicts(
  rules: ValidationRuleInput[] = []
): RuleConflict[] {
  const out: RuleConflict[] = [];
  const numGt: { i: number; n: number }[] = [];
  const numLt: { i: number; n: number }[] = [];
  const numEq: { i: number; n: number }[] = [];
  const lenGt: { i: number; n: number }[] = [];
  const lenLt: { i: number; n: number }[] = [];
  const lenEq: { i: number; n: number }[] = [];
  const includeAny: {
    i: number;
    values: Set<string>;
    caseSensitive: boolean;
  }[] = [];
  const includeAll: {
    i: number;
    values: Set<string>;
    caseSensitive: boolean;
  }[] = [];
  const excludeAny: {
    i: number;
    values: Set<string>;
    caseSensitive: boolean;
  }[] = [];
  const excludeAll: {
    i: number;
    values: Set<string>;
    caseSensitive: boolean;
  }[] = [];

  rules.forEach((r, i) => {
    const n = Number(r.keyword);
    if (r.criteria === "number_greater_than" && Number.isFinite(n))
      numGt.push({ i, n });
    if (r.criteria === "number_less_than" && Number.isFinite(n))
      numLt.push({ i, n });
    if (r.criteria === "number_equal_to" && Number.isFinite(n))
      numEq.push({ i, n });
    if (r.criteria === "character_limit_more_than" && Number.isFinite(n))
      lenGt.push({ i, n });
    if (r.criteria === "character_limit_less_than" && Number.isFinite(n))
      lenLt.push({ i, n });
    if (r.criteria === "character_limit_equal_to" && Number.isFinite(n))
      lenEq.push({ i, n });
    if (isSelectionCriteria(r.criteria)) {
      const raw = values(r);
      const normalized = raw.map((value) =>
        r.caseSensitive ? value : value.toLowerCase()
      );
      // Duplicate values are an authoring warning handled by definition-validation, not a logical contradiction.
      // Conflict detection only rejects combinations for which no possible entered value can satisfy the AND chain.
      const set = new Set(normalized);
      if (
        r.criteria === "selection_values_include" ||
        r.criteria === "selection_values_include_any"
      )
        includeAny.push({ i, values: set, caseSensitive: !!r.caseSensitive });
      if (r.criteria === "selection_values_include_all")
        includeAll.push({ i, values: set, caseSensitive: !!r.caseSensitive });
      if (
        r.criteria === "selection_values_exclude" ||
        r.criteria === "selection_values_exclude_any"
      )
        excludeAny.push({ i, values: set, caseSensitive: !!r.caseSensitive });
      if (r.criteria === "selection_values_exclude_all")
        excludeAll.push({ i, values: set, caseSensitive: !!r.caseSensitive });
    }
  });

  for (const a of numGt)
    for (const b of numLt)
      if (a.n >= b.n)
        out.push({
          code: "VR-X-NUM-RANGE",
          message: "Number rules conflict: range is empty.",
          indexes: [a.i, b.i]
        });
  for (let i = 0; i < numEq.length; i++)
    for (let j = i + 1; j < numEq.length; j++)
      if (numEq[i].n !== numEq[j].n)
        out.push({
          code: "VR-X-NUM-EQUALITY",
          message:
            "Number rules conflict: multiple different equality values are required.",
          indexes: [numEq[i].i, numEq[j].i]
        });
  for (const eq of numEq) {
    for (const lower of numGt)
      if (!(eq.n > lower.n))
        out.push({
          code: "VR-X-NUM-EQUALITY-RANGE",
          message: "Number equality conflicts with the lower-bound rule.",
          indexes: [eq.i, lower.i]
        });
    for (const upper of numLt)
      if (!(eq.n < upper.n))
        out.push({
          code: "VR-X-NUM-EQUALITY-RANGE",
          message: "Number equality conflicts with the upper-bound rule.",
          indexes: [eq.i, upper.i]
        });
  }
  for (const a of lenGt)
    for (const b of lenLt)
      if (a.n + 1 >= b.n)
        out.push({
          code: "VR-X-LEN-RANGE",
          message:
            "Character rules conflict: the allowed length range is empty.",
          indexes: [a.i, b.i]
        });
  for (const b of lenLt)
    if (b.n <= 0)
      out.push({
        code: "VR-X-LEN-RANGE",
        message: "Text length cannot be negative.",
        indexes: [b.i]
      });
  for (let i = 0; i < lenEq.length; i++)
    for (let j = i + 1; j < lenEq.length; j++)
      if (lenEq[i].n !== lenEq[j].n)
        out.push({
          code: "VR-X-LEN-EQUALITY",
          message:
            "Character rules conflict: multiple different exact lengths are required.",
          indexes: [lenEq[i].i, lenEq[j].i]
        });
  for (const eq of lenEq) {
    for (const lower of lenGt)
      if (!(eq.n > lower.n))
        out.push({
          code: "VR-X-LEN-EQUALITY-RANGE",
          message:
            "Exact character length conflicts with the lower-bound rule.",
          indexes: [eq.i, lower.i]
        });
    for (const upper of lenLt)
      if (!(eq.n < upper.n))
        out.push({
          code: "VR-X-LEN-EQUALITY-RANGE",
          message:
            "Exact character length conflicts with the upper-bound rule.",
          indexes: [eq.i, upper.i]
        });
  }

  // Cross-row selection contradictions are only inferred when casing semantics match. Otherwise the same authored
  // text can mean different sets in each row and a static contradiction claim would be unsafe.
  const selectionRules = [
    ...includeAny,
    ...includeAll,
    ...excludeAny,
    ...excludeAll
  ];
  const uniformSelectionCase = selectionRules.every(
    (item) => item.caseSensitive === (selectionRules[0]?.caseSensitive ?? false)
  );
  if (uniformSelectionCase) {
    // A required selection cannot simultaneously be forbidden by an Exclude Any rule.
    for (const required of includeAll)
      for (const forbidden of excludeAny) {
        const overlap = [...required.values].filter((value) =>
          forbidden.values.has(value)
        );
        if (overlap.length)
          out.push({
            code: "VR-X-SEL-REQUIRED-EXCLUDED",
            message: `Selection rules conflict: required value(s) ${overlap.join(", ")} are also excluded.`,
            indexes: [required.i, forbidden.i]
          });
      }
    // Include Any still becomes impossible when every candidate in that row is excluded individually.
    for (const required of includeAny) {
      const forbidden = new Set(excludeAny.flatMap((item) => [...item.values]));
      if (
        required.values.size &&
        [...required.values].every((value) => forbidden.has(value))
      ) {
        out.push({
          code: "VR-X-SEL-INCLUDE-ANY",
          message:
            "Selection rules conflict: every Include Any candidate is excluded.",
          indexes: [required.i, ...excludeAny.map((item) => item.i)]
        });
      }
    }
    // If an Include All rule necessarily selects every member of an Exclude All combination, no value can pass.
    const requiredUnion = new Set(
      includeAll.flatMap((item) => [...item.values])
    );
    for (const forbiddenGroup of excludeAll) {
      if (
        forbiddenGroup.values.size &&
        [...forbiddenGroup.values].every((value) => requiredUnion.has(value))
      ) {
        out.push({
          code: "VR-X-SEL-EXCLUDE-ALL",
          message:
            "Selection rules conflict: required selections necessarily create an excluded combination.",
          indexes: [...includeAll.map((item) => item.i), forbiddenGroup.i]
        });
      }
    }
  }

  return out;
}
