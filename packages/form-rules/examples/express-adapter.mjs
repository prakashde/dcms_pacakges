/** Executable Express route factory. Authorization and database transactions remain application-owned. */
import express from "express";
import { DcmsRuleError } from "@dcms/form-rules";
import { createIsolatedSession } from "./isolated/node-session.mjs";
/**
 * Build the draft/submit route around host authorization and a host transaction callback.
 * withRecordTransaction must resolve the permitted current definition and trusted references,
 * enforce concurrency, and atomically commit or roll back. Browser eligibility is never trusted.
 * The route reevaluates in a worker and commits original entered values only after the check.
 */
export function createRecordRouter({ authorize, withRecordTransaction }) {
  if (
    typeof authorize !== "function" ||
    typeof withRecordTransaction !== "function"
  )
    throw new TypeError(
      "Authorization and a transaction provider are required."
    );
  const router = express.Router();
  router.post(
    "/:recordId/transition",
    authorize,
    express.json({ limit: "2mb", strict: true }),
    async (req, res, next) => {
      try {
        const body = req.body;
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          !["draft", "submit"].includes(body.action)
        )
          return res.status(400).json({ code: "BAD_REQUEST" });
        if (
          Object.keys(body).some(
            (k) => !["action", "formId", "formVersion", "values"].includes(k)
          )
        )
          return res.status(400).json({ code: "UNEXPECTED_PROPERTY" });
        // The application resolves this record's permitted Form and version under its transaction.
        // The browser cannot choose a weaker definition or assert trusted external data.
        const outcome = await withRecordTransaction(
          req.params.recordId,
          req.user,
          async ({ definition, externalReferences, commit }) => {
            const session = await createIsolatedSession(definition);
            try {
              const evaluation = await session.evaluate({
                formId: body.formId,
                formVersion: body.formVersion,
                values: body.values,
                externalReferences
              });
              if (body.action === "submit" && !evaluation.canSubmit)
                return {
                  status: 422,
                  body: { code: "SUBMIT_VALIDATION_FAILED", evaluation }
                };
              await commit({
                action: body.action,
                values: body.values,
                formId: definition.formId,
                formVersion: definition.version
              });
              return {
                status: 200,
                body: { saved: true, action: body.action, evaluation }
              };
            } finally {
              await session.close();
            }
          }
        );
        res.status(outcome.status).json(outcome.body);
      } catch (error) {
        next(error);
      }
    }
  );
  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large")
      return res.status(413).json({ code: "PAYLOAD_TOO_LARGE" });
    if (error?.type === "entity.parse.failed")
      return res.status(400).json({ code: "INVALID_JSON" });
    const code = error?.code;
    if (code === "FORMULA_COMPATIBILITY")
      return res.status(409).json({ code, message: error.message });
    if (code === "PAYLOAD_INVALID" || code === "FORMULA_LIMIT_EXCEEDED")
      return res.status(400).json({ code, message: error.message });
    if (String(code).startsWith("WORKER_"))
      return res.status(503).json({ code });
    // Configuration/internal errors must not be converted into an ordinary validation pass.
    res.status(500).json({ code: "EVALUATION_UNAVAILABLE" });
  });
  return router;
}
