# DCMS Form Rules scenario guide

The added fixtures model recognizable Record-entry work and include explicit expected outcomes. All identifiers and thresholds are fictional. Run them through npm run verify or, after building, node --test test/review-scenarios.test.mjs. Each changed case starts from its fixture's baseline, so one failure does not contaminate another.

| Fixture | Baseline | Changes to try | Expected result |
|---|---|---|---|
| equipment-release.json | Reference 100, measured 100.5, 72 F and both safety checks | Measured 103; temperature 120; remove E-stop; shorten notes | Strict cases block; short notes warn and allow Submit |
| specimen-receipt.json | Manifest and received counts agree; DEMO label and custody checks | Count mismatch; invalid label; contradictory custody state | Strict fields block; missing optional detail warns |
| incoming-material.json | Dimension 25.1 with server nominal 25 | Dimension 26; OR-HOLD disposition; remove trusted nominal | Tolerance/disposition block; missing reference is an error |
| deviation-review.json | Completed containment narrative, substitution example and zero | Remove required term; change source code; nonzero delta | Expected keyword/transformation/equality failures |

The complete case names, patches and expected blocking/warning/error field IDs are stored with the JSON. Treat externalReferences in incoming-material as data obtained by the server. The public HTTP route does not accept that property from a browser.

## Interactive walkthrough

Open reference-ui/DCMS_Form_Rules_Review_Workbench_v0.10.5.html. Select Seed Data, choose Reviewed examples, allow replacement of the working seed and load it. The menu also retains the Atlas, representative suite, individual historical examples, authoring-error examples, unsaved state and 100 by 10 workload.

Use Review and Submit Revision to display inline Record previews. Each Form displays its Record readiness separately from authoring Saved status. Change measured pressure to 103 and observe blocking. Restore 100.5 and remove a required Checkbox value. Restore the checks and enter OK in technician notes to see an advisory warning. These controls are interactive test previews; they do not submit a Record to a server.

Select a field to reveal its criteria, including whether a formula transforms its value first. Use Edit to return to the Form Fields table. Open a validation rule to inspect its expression, criterion, keyword and row operator. Confirm updates the working definition; Save Form controls the local authoring state.

The Reviewed examples seed includes equipment release, specimen receipt and deviation review. The authoritative external-reference example stays in the Node fixtures. The older representative suite also includes a fictional patient/specimen illustration; its values are not clinical recommendations.

## Stress and edge cases

The stress seed distinguishes long plain text, rich visible text, punctuation treated literally, case sensitivity, duplicate Checkbox selections, mixed row precedence, no-validation state and a division-by-zero error. Long text uses a multiline control with a height limit. Rich content preserves supported formatting while the engine receives plain visible text.

The benchmark scripts separately test large formulas, 5 MB text, dependency fan-out and long legacy calculation chains. Large output probes now expect controlled rejection beyond the new limits instead of treating a large allocation as acceptable performance. A Bessel function stress case runs only inside a worker and is deliberately terminated.

## Existing Atlas

The Atlas retains stable ATLAS identifiers shared by docs/atlas, test/atlas.test.mjs and the UI seed. It covers formula-before-criterion, direct numeric ranges, composite rows, implicit/explicit keywords, warning and blocking states, normalized text, scalar selection and all Checkbox set modes. Its cases remain in the full suite; the review fixtures add realistic combinations and corrected boundaries.
