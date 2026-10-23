/** Reference workload generator used by the local prototype and tests; keeps demo data deterministic and reproducible. */
const gt = (keyword) => ({ criteria: "number_greater_than", keyword });
const lt = (keyword) => ({ criteria: "number_less_than", keyword });
const eq = (keyword) => ({ criteria: "number_equal_to", keyword });

// Ten industrial-style input groups, ten user inputs per group.
// Every input has ten independent formula -> validation pairs.
const groups = [
  {
    key: "temp",
    title: "Temperature probe",
    inputUnit: "°F",
    validRaw: 72,
    invalidRaw: 500,
    step: 3,
    pairs: (id) => {
      const c = "((VALUE - 32) * 5 / 9)";
      return [
        ["Celsius lower engineering limit", `=ROUND(${c}, 2)`, gt(-40)],
        ["Celsius upper engineering limit", `=ROUND(${c}, 2)`, lt(120)],
        ["Kelvin physical sanity", `=ROUND(${c} + 273.15, 2)`, gt(200)],
        ["Kelvin upper sanity", `=ROUND(${c} + 273.15, 2)`, lt(450)],
        ["Raw °F lower limit", "=ROUND(VALUE, 1)", gt(-40)],
        ["Raw °F upper limit", "=ROUND(VALUE, 1)", lt(250)],
        ["Absolute Celsius sanity", `=ABS(${c})`, lt(200)],
        ["Rounded Celsius display", `=ROUND(${c}, 1)`, lt(120)],
        ["High temperature alarm", `=IF(${c} > 110, 1, 0)`, eq(0)],
        [
          "Peer delta check",
          id === "temp_01"
            ? `=ABS(ROUND(${c},2) - 20)`
            : `=ABS(ROUND(${c},2) - ROUND((FIELD("temp_01") - 32) * 5 / 9, 2))`,
          lt(150)
        ]
      ];
    }
  },
  {
    key: "pressure",
    title: "Hydraulic pressure",
    inputUnit: "psi",
    validRaw: 80,
    invalidRaw: 250,
    step: 4,
    pairs: (id) => [
      ["kPa upper limit", "=VALUE * 6.894757293168", lt(1400)],
      ["kPa must be positive", "=VALUE * 6.894757293168", gt(0)],
      ["bar display sanity", "=VALUE * 0.0689475729", lt(20)],
      ["MPa display sanity", "=VALUE * 0.00689475729", lt(2)],
      ["psi minimum process value", "=ROUND(VALUE, 1)", gt(5)],
      ["psi maximum process value", "=ROUND(VALUE, 1)", lt(200)],
      ["Absolute pressure sanity", "=ABS(VALUE)", lt(250)],
      ["High pressure alarm", "=IF(VALUE > 180, 1, 0)", eq(0)],
      ["Low pressure alarm", "=IF(VALUE < 10, 1, 0)", eq(0)],
      ["Percent of 150 psi reference", "=VALUE / 150 * 100", lt(150)]
    ]
  },
  {
    key: "length",
    title: "Part dimension",
    inputUnit: "in",
    validRaw: 2.5,
    invalidRaw: 60,
    step: 0.2,
    pairs: (id) => [
      ["Millimeter minimum", "=VALUE * 25.4", gt(1)],
      ["Millimeter maximum", "=VALUE * 25.4", lt(2000)],
      ["Centimeter sanity", "=VALUE * 2.54", lt(200)],
      ["Meter sanity", "=VALUE * 0.0254", lt(2)],
      ["Raw inch minimum", "=ROUND(VALUE, 3)", gt(0.01)],
      ["Raw inch maximum", "=ROUND(VALUE, 3)", lt(50)],
      ["Absolute mm sanity", "=ABS(VALUE * 25.4)", lt(2500)],
      ["High length alarm", "=IF(VALUE > 40, 1, 0)", eq(0)],
      ["Low length alarm", "=IF(VALUE < 0.05, 1, 0)", eq(0)],
      ["Micron conversion sanity", "=VALUE * 25400", lt(2000000)]
    ]
  },
  {
    key: "mass",
    title: "Component mass",
    inputUnit: "lb",
    validRaw: 25,
    invalidRaw: 500,
    step: 1,
    pairs: (id) => [
      ["Kilogram minimum", "=VALUE * 0.45359237", gt(0)],
      ["Kilogram maximum", "=VALUE * 0.45359237", lt(200)],
      ["Gram conversion sanity", "=VALUE * 453.59237", lt(200000)],
      ["Ounce conversion sanity", "=VALUE * 16", lt(5000)],
      ["Raw lb minimum", "=ROUND(VALUE, 2)", gt(0.1)],
      ["Raw lb maximum", "=ROUND(VALUE, 2)", lt(450)],
      ["Absolute kg sanity", "=ABS(VALUE * 0.45359237)", lt(250)],
      ["High mass alarm", "=IF(VALUE > 400, 1, 0)", eq(0)],
      ["Low mass alarm", "=IF(VALUE < 0.1, 1, 0)", eq(0)],
      ["Rounded kg display", "=ROUND(VALUE * 0.45359237, 3)", lt(200)]
    ]
  },
  {
    key: "torque",
    title: "Fastener torque",
    inputUnit: "lbf·in",
    validRaw: 60,
    invalidRaw: 900,
    step: 3,
    pairs: (id) => [
      ["N·m minimum", "=VALUE * 0.112984829", gt(0)],
      ["N·m maximum", "=VALUE * 0.112984829", lt(100)],
      ["lbf·ft sanity", "=VALUE / 12", lt(100)],
      ["Raw torque minimum", "=ROUND(VALUE, 1)", gt(1)],
      ["Raw torque maximum", "=ROUND(VALUE, 1)", lt(800)],
      ["Absolute N·m sanity", "=ABS(VALUE * 0.112984829)", lt(120)],
      ["High torque alarm", "=IF(VALUE > 700, 1, 0)", eq(0)],
      ["Low torque alarm", "=IF(VALUE < 1, 1, 0)", eq(0)],
      ["Rounded N·m display", "=ROUND(VALUE * 0.112984829, 2)", lt(100)],
      ["kgf·cm conversion sanity", "=VALUE * 1.15212462", lt(1000)]
    ]
  },
  {
    key: "time",
    title: "Process time",
    inputUnit: "min",
    validRaw: 30,
    invalidRaw: 600,
    step: 2,
    pairs: (id) => [
      ["Seconds minimum", "=VALUE * 60", gt(0)],
      ["Seconds maximum", "=VALUE * 60", lt(28800)],
      ["Hours minimum", "=VALUE / 60", gt(0)],
      ["Hours maximum", "=VALUE / 60", lt(8)],
      ["Raw minutes minimum", "=ROUND(VALUE, 2)", gt(0)],
      ["Raw minutes maximum", "=ROUND(VALUE, 2)", lt(480)],
      ["High duration alarm", "=IF(VALUE > 420, 1, 0)", eq(0)],
      ["Low duration alarm", "=IF(VALUE < 0.1, 1, 0)", eq(0)],
      ["Milliseconds sanity", "=VALUE * 60000", lt(30000000)],
      ["Day fraction sanity", "=VALUE / 1440", lt(1)]
    ]
  },
  {
    key: "flow",
    title: "Flow rate",
    inputUnit: "gpm",
    validRaw: 4,
    invalidRaw: 30,
    step: 0.2,
    pairs: (id) => [
      ["L/min minimum", "=VALUE * 3.785411784", gt(0)],
      ["L/min maximum", "=VALUE * 3.785411784", lt(100)],
      ["mL/s sanity", "=VALUE * 63.0901964", lt(2000)],
      ["Raw gpm minimum", "=ROUND(VALUE, 3)", gt(0.1)],
      ["Raw gpm maximum", "=ROUND(VALUE, 3)", lt(25)],
      ["Absolute L/min sanity", "=ABS(VALUE * 3.785411784)", lt(120)],
      ["High flow alarm", "=IF(VALUE > 20, 1, 0)", eq(0)],
      ["Low flow alarm", "=IF(VALUE < 0.1, 1, 0)", eq(0)],
      ["L/s conversion sanity", "=VALUE * 0.0630901964", lt(2)],
      ["m³/hour conversion sanity", "=VALUE * 0.227124707", lt(10)]
    ]
  },
  {
    key: "voltage",
    title: "Voltage",
    inputUnit: "V",
    validRaw: 24,
    invalidRaw: 600,
    step: 0.5,
    pairs: (id) => [
      ["mV minimum", "=VALUE * 1000", gt(0)],
      ["mV maximum", "=VALUE * 1000", lt(600000)],
      ["kV sanity", "=VALUE / 1000", lt(1)],
      ["Raw V minimum", "=ROUND(VALUE, 3)", gt(0.1)],
      ["Raw V maximum", "=ROUND(VALUE, 3)", lt(480)],
      ["Absolute voltage sanity", "=ABS(VALUE)", lt(600)],
      ["High voltage alarm", "=IF(VALUE > 300, 1, 0)", eq(0)],
      ["Low voltage alarm", "=IF(VALUE < 0.1, 1, 0)", eq(0)],
      ["Percent of 24 V reference", "=VALUE / 24 * 100", lt(200)],
      ["Rounded display value", "=ROUND(VALUE, 1)", lt(480)]
    ]
  },
  {
    key: "current",
    title: "Current",
    inputUnit: "A",
    validRaw: 2.5,
    invalidRaw: 100,
    step: 0.1,
    pairs: (id) => [
      ["mA minimum", "=VALUE * 1000", gt(0)],
      ["mA maximum", "=VALUE * 1000", lt(100000)],
      ["Raw A minimum", "=ROUND(VALUE, 3)", gt(0.01)],
      ["Raw A maximum", "=ROUND(VALUE, 3)", lt(80)],
      ["Absolute current sanity", "=ABS(VALUE)", lt(100)],
      ["High current alarm", "=IF(VALUE > 60, 1, 0)", eq(0)],
      ["Low current alarm", "=IF(VALUE < 0.01, 1, 0)", eq(0)],
      ["Percent of 20 A reference", "=VALUE / 20 * 100", lt(400)],
      ["Rounded mA display", "=ROUND(VALUE * 1000, 1)", lt(100000)],
      ["Current squared sanity", "=VALUE ^ 2", lt(6400)]
    ]
  },
  {
    key: "note",
    title: "Inspection note",
    inputUnit: "",
    validRaw: "PASS LOT A123",
    invalidRaw: "FAIL",
    step: 0,
    valueType: "string",
    pairs: (id) => [
      [
        "Normalized note contains PASS",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "PASS" }
      ],
      [
        "Normalized note contains LOT",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "LOT" }
      ],
      [
        "Normalized note contains batch token",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "A123" }
      ],
      [
        "Reject explicit FAIL keyword",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "NOT FAIL" }
      ],
      [
        "Minimum meaningful length",
        "=TRIM(VALUE)",
        { criteria: "character_limit_more_than", keyword: 7 }
      ],
      [
        "Maximum note length",
        "=TRIM(VALUE)",
        { criteria: "character_limit_less_than", keyword: 80 }
      ],
      [
        "Uppercase normalization still bounded",
        "=UPPER(TRIM(VALUE))",
        { criteria: "character_limit_less_than", keyword: 80 }
      ],
      [
        "Concatenated audit preview bounded",
        '=CONCAT("NOTE:", UPPER(TRIM(VALUE)))',
        { criteria: "character_limit_less_than", keyword: 90 }
      ],
      [
        "Required phrase combination",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "PASS AND (LOT OR BATCH)" }
      ],
      [
        "No reject phrase",
        "=UPPER(TRIM(VALUE))",
        { criteria: "required_keywords", keyword: "NOT REJECT" }
      ]
    ]
  }
];

function makeRows(fieldId, group) {
  return group.pairs(fieldId).map((x, i) => ({
    id: `${fieldId}_vr_${String(i + 1).padStart(2, "0")}`,
    label: x[0],
    expression: x[1],
    operator: i === 0 ? "AND" : "AND",
    ...x[2]
  }));
}

export function buildPrototypeDefinition() {
  const fields = [];
  const meta = new Map();
  let index = 0;
  for (const group of groups) {
    for (let i = 1; i <= 10; i++) {
      index++;
      const id = `${group.key}_${String(i).padStart(2, "0")}`;
      const mustBeCorrect = index % 4 !== 0; // 75 strict, 25 warning-only fields.
      fields.push({
        id,
        label: `${group.title} ${i}`,
        valueType: group.valueType ?? "number",
        mustBeCorrect,
        validationRows: makeRows(id, group)
      });
      meta.set(id, {
        ...group,
        mustBeCorrect,
        index,
        label: `${group.title} ${i}`
      });
    }
  }
  return {
    definition: { formId: "dcms-100x10-prototype", version: "0.8.0", fields },
    meta
  };
}

export function buildInitialValues(meta) {
  const values = new Map();
  for (const [id, m] of meta) {
    const fail = m.index % 13 === 0 || m.index % 19 === 0;
    const offset = ((m.index % 5) - 2) * m.step;
    values.set(id, fail ? m.invalidRaw : m.validRaw + offset);
  }
  return values;
}

export function buildAllValidValues(meta) {
  const values = new Map();
  for (const [id, m] of meta) values.set(id, m.validRaw);
  return values;
}

export function buildKnownFailureValues(meta) {
  const values = buildAllValidValues(meta);
  const byGroup = new Map();
  for (const [id, m] of meta)
    if (!byGroup.has(m.key)) byGroup.set(m.key, [id, m]);
  for (const [id, m] of byGroup.values()) values.set(id, m.invalidRaw);
  return values;
}

export function valuesMapToObject(values) {
  return Object.fromEntries(values);
}
export function valuesObjectToMap(obj) {
  return new Map(Object.entries(obj ?? {}));
}
