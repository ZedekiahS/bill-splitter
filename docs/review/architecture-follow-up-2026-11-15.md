# Static paths, request diagnostics and creation lifecycle

## Scope

Follow-up to the architecture review of `2b2e5ef`. This is a bounded first step:
fix legacy HTML publication, add safe basic diagnostics, and extract creation and
dialog lifecycle logic. No domain rules, storage layout, dependencies, framework,
financial request keys or database migrations changed.

## Static publication and diagnostics

The regression test first reproduced `GET /home%2ehtml` returning the old HTML.
Static authorization now runs through the installed static module's `allowedPath`
interface, which checks normalized and final resolved file paths. Both current
HTML entry points remain accessible; legacy HTML and Firebase reserved paths are
denied, including encoded dot/name variants. GET and HEAD are covered, as are the
new browser module URLs and existing cache headers.

`server/request-logging.mjs` supplies allowlisted diagnostics. The normal startup
enables structured logs, configurable by `LOG_LEVEL`. Server-generated request IDs
are returned as `X-Request-Id`. Completion logs include method, route template,
status and elapsed time; 5xx logs add error type, bounded code and application
source locations. Raw request URLs, query strings, headers, financial bodies,
responses and raw error messages/details are not logged. Framework request logging
is suppressed through its supported LogController so it cannot bypass this policy.
Canary tests inject secrets into passwords, recovery codes, cookies, authorization,
request-ID headers, invite paths, queries, amounts, notes and database errors; none
appear in captured logs. This is basic diagnostics, not a deployed monitoring stack.

## Frontend modules

- `dialog-lifecycle.mjs`: owns UI operation generations, current dialog identity,
  submission eligibility, replacement, user close, successful completion, navigation,
  Escape, queued native close events and focus restoration. A completed window may
  retain its pending continuation; navigation/replacement invalidates it. Creation
  dialogs opt into closing on departure. Existing expense draft behavior remains.
- `ledger-creation.mjs`: owns personal/shared form markup, scoped DOM queries,
  pre-write validity checks, the store command and handling of late results/errors.
- `app.mjs`: wires these modules to existing views, draft release, synchronization
  and post-create loading. It no longer maintains a separate editorRequest counter
  or native dialog close/cancel handlers. Data/report generations and durable
  financial submission state stay independent.

Browser testing found an additional history path: Back could change the URL while
the creation dialog remained visible without the expected hashchange handling.
`popstate` now also leaves the current entry flow. Four personal/shared and
unsubmitted/in-flight history-return cases were added. The actual browser Back
path was rechecked after the fix: the old form closed and a fresh shared creation
still succeeded. This is not a claim of exhaustive mobile back/forward-cache testing.

## Evidence

- Final `npm test`: **358 passed**. Includes the previous 348 plus four direct
  dialog/creation interface cases, two server-boundary/logging cases, and four
  popstate cases. Existing whole-app DOM regressions remain; the new module tests
  use exported interfaces without extracting app source.
- Real PostgreSQL/Fastify isolated API run: **79 passed**. Executed after server
  changes; the later popstate-only change was covered by frontend regression and
  browser verification. API tests used a dedicated schema and removed it afterwards.
- Actual browser with the real server and a separate disposable PostgreSQL schema:
  registered a synthetic account; opened personal creation, cancelled with Escape
  and verified focus returned; created and directly entered a first expense;
  preserved a 12.50 breakfast draft, switched to English, reopened and saved it;
  tested browser Back from shared creation, then created a new shared ledger and
  reached members; returned to the saved personal expense and switched to Chinese.
  Browser console inspection returned no errors.
- Local screenshot: `.local/architecture-browser-2026-11-15.png` (not committed).
- `git diff --check` passed. No user ledger data was touched.

No physical phone, container deployment, production rollout, load benchmark, full
service backup drill, shared-domain relocation or broader editor/report rewrite
was performed. Those remain separate work with their own acceptance criteria.
