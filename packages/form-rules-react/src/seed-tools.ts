/**
 * Deterministic reference/qualification seed helpers.
 *
 * These utilities reproduce standalone Workbench development states. They do
 * not define production DCMS identifiers, persistence, or workflow policy.
 */
/** Stable non-cryptographic hash used only to seed repeatable test data. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngFor(...parts: string[]) {
  return mulberry32(hashSeed(parts.join("|")));
}
export interface SeedPackage {
  schemaVersion: 1;
  revision: unknown;
  records: Record<string, unknown>;
}
/** Serialize Revision metadata and Record values into the reference seed format. */
export function createSeedPackage(
  revision: unknown,
  records: Record<string, unknown>
): SeedPackage {
  return { schemaVersion: 1, revision, records };
}
/** Parse only the seed package envelope; applying imported state is a caller decision. */
export function parseSeedPackage(input: string): SeedPackage {
  const parsed = JSON.parse(input);
  if (
    parsed?.schemaVersion !== 1 ||
    !("revision" in parsed) ||
    !("records" in parsed)
  ) {
    throw new Error("Invalid Workbench seed package.");
  }
  return parsed;
}

export function deterministicNumber(
  seed: string,
  minimum: number,
  maximum: number
) {
  const rng = rngFor(seed);
  return minimum + rng() * (maximum - minimum);
}
/**
 * Produce deterministic example values for every supported Workbench field
 * category. Values are qualification fixtures, not guaranteed-valid inputs.
 */
export function seedValuesForWorkbenchModel(
  seed: string,
  fields: readonly {
    id: string;
    category: string;
    options?: readonly string[];
  }[]
): Record<string, unknown> {
  const rng = rngFor(seed, "record");
  return Object.fromEntries(
    fields.map((field) => {
      if (field.category === "Number")
        return [field.id, Math.round(rng() * 1000) / 10];
      if (field.category === "Radio")
        return [field.id, field.options?.[0] ?? ""];
      if (field.category === "Checkbox")
        return [field.id, field.options?.slice(0, 1) ?? []];
      if (field.category === "Rich Text")
        return [field.id, `Seeded observation ${Math.floor(rng() * 1000)}`];
      return [field.id, `Seed-${Math.floor(rng() * 100000)}`];
    })
  );
}
export function revisionSeedLabel(seed: string) {
  return `Revision seed: ${seed}`;
}
export function recordSeedLabel(seed: string) {
  return `Record seed: ${seed}`;
}

export const REFERENCE_REVISION_PROFILES = [
  "multi-form",
  "simple3",
  "validation-atlas",
  "scenario-suite",
  "review-suite",
  "equipment-testing",
  "patient-intake",
  "incoming-inspection",
  "deviation-report",
  "stress-edge",
  "authoring-warnings",
  "definition-error",
  "unsaved",
  "scale"
] as const;
export type ReferenceRevisionProfile =
  (typeof REFERENCE_REVISION_PROFILES)[number];
export interface RevisionSeedNodeSpec {
  nodeId: string;
  title: string;
  scenario: string;
  seed: string;
}
/** Reproduce the reference Revision profile/node catalogue deterministically. */
export function revisionSeedNodeSpecs(
  seed: string,
  profile: ReferenceRevisionProfile
): RevisionSeedNodeSpec[] {
  const known: Record<string, readonly [string, string, string][]> = {
    simple3: [
      ["form-1", "Form 1", "screenshot"],
      ["form-2", "Form 2", "formula-transform"],
      ["form-3", "Form 3", "cross-field"]
    ],
    "validation-atlas": [["atlas-1", "Validation Atlas", "validation-atlas"]],
    "scenario-suite": [
      ["atlas-1", "Validation Atlas", "validation-atlas"],
      [
        "equipment-1",
        "Equipment Commissioning & Safety Test",
        "equipment-testing"
      ],
      [
        "patient-1",
        "Fictional Patient Intake & Specimen Collection",
        "patient-intake"
      ],
      [
        "incoming-1",
        "Incoming Material Inspection & Lot Disposition",
        "incoming-inspection"
      ],
      [
        "deviation-1",
        "Quality Deviation / Incident Report",
        "deviation-report"
      ],
      [
        "stress-edge-1",
        "Long Text / Rich Text / Stress & Edge-Case Inputs",
        "stress-edge-text"
      ]
    ],
    "equipment-testing": [
      [
        "equipment-1",
        "Equipment Commissioning & Safety Test",
        "equipment-testing"
      ]
    ],
    "patient-intake": [
      [
        "patient-1",
        "Fictional Patient Intake & Specimen Collection",
        "patient-intake"
      ]
    ],
    "incoming-inspection": [
      [
        "incoming-1",
        "Incoming Material Inspection & Lot Disposition",
        "incoming-inspection"
      ]
    ],
    "deviation-report": [
      ["deviation-1", "Quality Deviation / Incident Report", "deviation-report"]
    ],
    "stress-edge": [
      [
        "stress-edge-1",
        "Long Text / Rich Text / Stress & Edge-Case Inputs",
        "stress-edge-text"
      ]
    ],
    "authoring-warnings": [
      ["form-1", "Form 1", "implicit-or"],
      ["form-2", "Form 2", "screenshot"],
      ["form-3", "Form 3", "implicit-or"],
      ["form-4", "Form 4", "formula-transform"]
    ],
    scale: [
      ["form-1", "Form 1", "screenshot"],
      ["form-2", "Form 2 — 100×10", "scale100x10"],
      ["form-3", "Form 3", "formula-transform"]
    ],
    "multi-form": [
      ["form-1", "Form 1", "screenshot"],
      ["form-2", "Form 2", "formula-transform"],
      ["form-3", "Form 3", "cross-field"],
      ["form-4", "Form 4", "implicit-or"],
      ["form-5", "Form 5", "screenshot"],
      ["form-6", "Form 6", "screenshot"]
    ]
  };
  const base = known[profile] ?? known["multi-form"];
  return base.map(([nodeId, title, scenario], i) => ({
    nodeId,
    title,
    scenario,
    seed: `${seed}-${i + 1}`
  }));
}
