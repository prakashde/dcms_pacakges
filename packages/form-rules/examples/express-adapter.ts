/** See the executable, HTTP-tested route in express-adapter.mjs. */
// createRecordRouter requires two application hooks:
// authorize: authenticates the caller and checks access to the record, including company scope.
// withRecordTransaction: loads the permitted definition and server references; commits raw values
// and the workflow transition atomically, rejecting a concurrent definition/record version change.
// The example rejects browser externalReferences, uses a terminable worker, and returns 422 when
// Submit is blocked. Do not implement the hooks as permissive defaults in production.
export {};
