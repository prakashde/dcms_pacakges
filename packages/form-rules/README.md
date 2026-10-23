# @dcms/form-rules 0.10.5

Shared formula, validation, compilation and Record-evaluation semantics for browser and Node consumers. This package does not authorize requests, persist Records or implement production workflow.

Read [the package guide](docs/PACKAGE_GUIDE.md) for a complete call and [the full reference](docs/FULL_REFERENCE.md) for contracts. Install the supplied tarball into a separate application. ESM and CommonJS entries and TypeScript declarations are included after building.

From the development workspace run `npm run pack:engine`, then `npm run qualify:engine:consumer` and `npm run qualify:engine:installed`. The runtime payload includes source, schemas, required guides and notices but not the development workspace, examples or internal process documents. The first-party license remains UNLICENSED.

## Executable quick start

<!-- dcms-example {"id":"README-QUICKSTART","stdout":"true\n"} -->
```js
import {compileForm, evaluateRecordPayload} from '@dcms/form-rules';
const definition = {
  formId: 'temperature', version: 1,
  fields: [{id: 'f', label: 'Temperature F', valueType: 'number',
    mustBeCorrect: true,
    validationRows: [{id: 'range', expression: '(VALUE-32)*5/9',
      criteria: 'number_less_than', keyword: 105}]}]
};
const plan = compileForm(definition);
const result = evaluateRecordPayload(plan, {
  formId: 'temperature', formVersion: 1, values: {f: 212}
});
console.log(result.canSubmit); // true; stored input remains 212
```
