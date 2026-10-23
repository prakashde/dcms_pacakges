/**
 * Preflight resource checks for Formula.js allocation/iteration magnifiers.
 * Output checks alone happen too late to prevent a huge REPT or matrix allocation. These guards
 * reject predictable expansion before calling the pinned implementation. Worker deadlines are still
 * required for arbitrary untrusted formulas because synchronous third-party calls cannot be preempted.
 */
import type { DcmsValue } from "./types.js";
import { DATA_LIMITS } from "./limits.js";
import { DcmsRuleError } from "./errors.js";
function flatten(values: DcmsValue[]): (number | string | boolean | null)[] {
  const out: (number | string | boolean | null)[] = [];
  const visit = (v: DcmsValue): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else out.push(v);
  };
  values.forEach(visit);
  return out;
}
const limit = (name: string, what: string): never => {
  throw new DcmsRuleError(
    "FORMULA_LIMIT_EXCEEDED",
    `${name} exceeds the ${what} limit.`,
    { functionName: name }
  );
};
function num(value: DcmsValue | undefined): number {
  return Number(value);
}
function requireSize(name: string, size: number, cap: number): void {
  if (!Number.isFinite(size) || size > cap) limit(name, "allocation/iteration");
}
/**
 * Reject known allocation/iteration expansions before an eager function runs.
 * name must be the normalized registry name. These targeted checks are not a general
 * CPU or memory guarantee; untrusted formulas also need a terminable worker deadline.
 */
export function guardFunctionArguments(name: string, args: DcmsValue[]): void {
  const [a, b, c] = args;
  if (name === "REPT") {
    requireSize(name, num(b), DATA_LIMITS.maxFunctionIterations);
    requireSize(
      name,
      String(a ?? "").length * num(b),
      DATA_LIMITS.maxOutputCharacters
    );
  }
  if (name === "MUNIT")
    requireSize(name, num(a) ** 2 + num(a) + 1, DATA_LIMITS.maxOutputNodes);
  if (name === "BASE")
    requireSize(name, num(c ?? 0), DATA_LIMITS.maxOutputCharacters);
  if (name === "ROMAN")
    requireSize(name, num(a) / 1000 + 32, DATA_LIMITS.maxOutputCharacters);
  if (name === "FACT" || name === "FACTDOUBLE") requireSize(name, num(a), 300);
  if (
    ["COMBIN", "COMBINA", "PERMUT", "PERMUTATIONA", "MULTINOMIAL"].includes(
      name
    )
  )
    for (const x of flatten(args)) requireSize(name, num(x), 300);
  if (name === "LCM")
    for (const x of flatten(args))
      requireSize(name, Math.abs(num(x)), DATA_LIMITS.maxFunctionIterations);
  if (
    [
      "BINOM.DIST.RANGE",
      "BINOM.INV",
      "CRITBINOM",
      "CUMIPMT",
      "CUMPRINC",
      "FVSCHEDULE",
      "SERIESSUM"
    ].includes(name)
  )
    for (const x of args)
      if (typeof x === "number")
        requireSize(name, Math.abs(x), DATA_LIMITS.maxFunctionIterations);
  if (name === "MMULT" && Array.isArray(a) && Array.isArray(b)) {
    const columns = Array.isArray(b[0]) ? b[0].length : 0;
    requireSize(name, a.length * (columns + 1) + 1, DATA_LIMITS.maxOutputNodes);
    requireSize(
      name,
      a.length * b.length * columns,
      DATA_LIMITS.maxFunctionIterations
    );
  }
  if (["MDETERM", "MINVERSE"].includes(name) && Array.isArray(a))
    requireSize(name, a.length ** 3, DATA_LIMITS.maxFunctionIterations);
  if (
    name === "SUBSTITUTE" &&
    typeof a === "string" &&
    typeof b === "string" &&
    typeof c === "string" &&
    b.length &&
    c.length > b.length
  ) {
    // Conservative upper estimate avoids materializing a huge split-array or output first.
    requireSize(
      name,
      a.length +
        (args.length > 3 ? 1 : Math.floor(a.length / b.length)) *
          (c.length - b.length),
      DATA_LIMITS.maxOutputCharacters
    );
  }
  if (["TEXTJOIN", "CONCAT", "CONCATENATE"].includes(name)) {
    const flat = flatten(args);
    const inputChars = flat.reduce<number>(
      (n, x) => n + String(x ?? "").length,
      0
    );
    const delimiter = name === "TEXTJOIN" ? String(a ?? "").length : 0;
    requireSize(
      name,
      inputChars + delimiter * flat.length,
      DATA_LIMITS.maxOutputCharacters
    );
  }
}
/** Correct occurrence numbering while keeping matching literal and case sensitive. */
export function substitute(args: DcmsValue[]): DcmsValue {
  if (
    args.length < 3 ||
    args.length > 4 ||
    !args.slice(0, 3).every((x) => typeof x === "string")
  )
    throw new DcmsRuleError(
      "FORMULA_BAD_ARGUMENTS",
      "SUBSTITUTE expects three strings and an optional positive occurrence number."
    );
  const [text, oldText, newText] = args as [string, string, string];
  if (!oldText) return text;
  if (args.length === 3) return text.split(oldText).join(newText);
  const instance = num(args[3]);
  if (!Number.isSafeInteger(instance) || instance < 1)
    throw new DcmsRuleError(
      "FORMULA_BAD_ARGUMENTS",
      "SUBSTITUTE occurrence must be a positive finite integer."
    );
  let offset = 0;
  for (let n = 1; n <= instance; n++) {
    const at = text.indexOf(oldText, offset);
    if (at < 0) return text;
    if (n === instance)
      return text.slice(0, at) + newText + text.slice(at + oldText.length);
    offset = at + oldText.length;
  }
  return text;
}
