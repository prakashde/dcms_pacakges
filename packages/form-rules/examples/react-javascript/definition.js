/** Fictional local demonstration; the server imports the same controlled definition. */
export const definition = {
  formId: "react-express-demo",
  version: 1,
  fields: [
    {
      id: "limit",
      label: "Pressure limit",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [
        { id: "positive", criteria: "number_greater_than", keyword: 0 }
      ]
    },
    {
      id: "measured",
      label: "Measured pressure",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [
        {
          id: "under-limit",
          expression: 'VALUE-FIELD("limit")',
          criteria: "number_less_than",
          keyword: 0
        }
      ]
    },
    {
      id: "note",
      label: "Technician note",
      valueType: "string",
      mustBeCorrect: false,
      validationRows: [
        { id: "detail", criteria: "required_keywords", keyword: "CHECKED" }
      ]
    }
  ]
};
export const initialValues = {
  limit: 100,
  measured: 95,
  note: "CHECKED demonstration fixture"
};
