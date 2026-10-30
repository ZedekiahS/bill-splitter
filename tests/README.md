# Bill Splitter tests

Run commands from the repository directory with Node 22+. Calculation suites use
the shipped application modules with lightweight stubs or isolated storage; no
login, npm test dependencies, emulator, or network is needed.

## Current PostgreSQL API suite

Run `npm ci`. Set `TEST_DATABASE_URL` in ignored `.env.test` to a dedicated,
local database ending in `_test`, then run `npm run test:api`. The suite migrates
and **truncates fixture tables** in that database. Non-loopback hosts and other
database names are rejected. Always use a disposable test database.

These tests use real PostgreSQL transactions through Fastify request injection:
registration, session revocation, CSRF, request limits, authenticated ownership,
invitation approval, payer restrictions, concurrent idempotent writes, overpayment
races, reversals, private receipts, recurring duplicate prevention and persistence
across server instances. No Firebase credentials are needed. Browser evidence is
documented in [the current review](../docs/review/self-hosted.md).

## Calculation and storage suites

```powershell
node tests/bill-calculations.test.mjs
node tests/ledger-core.test.mjs
node tests/i18n.test.mjs
node tests/expense-search.test.mjs
node tests/expense-features.test.mjs
node tests/expense-features-store.test.mjs
node tests/invitation-navigation.test.mjs
```

All 155 local tests pass across these seven suites.

| Suite | Cases | Coverage |
| --- | ---: | --- |
| `bill-calculations.test.mjs` | 65 | Original create/edit handlers, exact cents, percentage rounding, draft preservation, UTC grouping/filtering and daylight-saving boundaries |
| `ledger-core.test.mjs` | 42 | Shared-ledger shares and balances, exact-amount splits and total validation, partial repayments and reversals, invitations/identity approval, isolated storage, settlement text, dates and participant limits |
| `i18n.test.mjs` | 7 | Remembered language, unavailable storage, literal user content, calendar dates, translated errors and statements, message coverage |
| `expense-search.test.mjs` | 4 | Chinese text composition, native search clearing, and input events |
| `expense-features.test.mjs` | 21 | Item totals and rounding, receipts, recurrence dates, month ends, leap years, consumed occurrences |
| `expense-features-store.test.mjs` | 13 | Template lifecycle, due dates, atomic duplicate rejection, metadata persistence, cloud adapter document assembly |
| `invitation-navigation.test.mjs` | 3 | Actual app refresh/language handlers after approval and stale repayment balance recovery |

The original bill flow divides among selected debtors, excluding the payer. The
new shared-ledger flow explicitly selects participants and allows the payer to
share the expense. Both accept monetary inputs with at most two decimal places.
Percentage totals must be greater than 0 and at most 100; largest remainders
allocate rounding cents, with participant order breaking ties. The payer covers
the unassigned portion. Original metadata-only edits preserve stored shares.

Original bill dates use UTC-midnight timestamps. New ledger dates use validated
`YYYY-MM-DD` strings, checked as UTC calendar days to avoid timezone shifts.
These suites establish client behavior, not production permissions.

## Historical Firestore emulator suites

These cover retained Firebase source, not the active Node/PostgreSQL API.

Install Firebase CLI and a compatible Java runtime. The local test configuration
binds Firestore to `127.0.0.1:8280`. Run the suites separately:

```powershell
firebase emulators:exec --only firestore --project demo-bill-splitter-permissions --config firebase.test.json "node tests/firestore-rules.test.mjs"
firebase emulators:exec --only firestore --project demo-bill-splitter-ledgers --config firebase.test.json "node tests/ledger-rules.test.mjs"
```

The CLI supplies `FIRESTORE_EMULATOR_HOST` to each test process. When attaching to
an already running emulator, explicitly use its port:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8281'
node tests/ledger-rules.test.mjs
node tests/firestore-rules.test.mjs
```

Without that environment variable, the legacy suite defaults to port **8280** and
the shared-ledger suite defaults to **8281**. Their project IDs are fixed in the
tests regardless of the shell's Firebase project selection.

On this workstation, JDK 23 can be selected if the terminal still resolves Java 8:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

| Suite | Cases | Fixed emulator project |
| --- | ---: | --- |
| `firestore-rules.test.mjs` | 32 | `demo-bill-splitter-permissions` |
| `ledger-rules.test.mjs` | 44 | `demo-bill-splitter-ledgers` |

Each suite loads the repository's `firestore.rules`, clears only its fixed
emulator project's data, and seeds synthetic fixtures. Non-loopback addresses
are rejected. Do not run concurrent copies against the same project. Fixture
seeding uses an emulator-only administrative token; access assertions use test
user tokens or no token. Production credentials and data are not used.

## Permission boundaries

| Resource | Access and writes |
| --- | --- |
| `users/{uid}` | Signed-in directory reads; only the profile owner can write known fields |
| `bills/{id}` | Original payer or listed debtor can read; only the original payer can update and confirm repayment |
| `ledgers/{id}` | Non-anonymous authenticated members can read; owner creates and grants membership through atomic invitation approval |
| Ledger `members` | Ledger members can read; owner adds temporary identities and approves account binding |
| Ledger `expenses` | Ledger members can read; owner can record for any member, other bound members only as themselves |
| Ledger `templates`, `templateDetails` | Members read; creator or owner manages; an ordinary member records themselves as payer |
| Ledger `occurrences` | Creator or owner skips or atomically posts a due occurrence; entries cannot be reused |
| Ledger `expenseDetails`, `expenseReceipts` | Members read; written atomically with the associated expense and immutable afterward |
| Ledger `payments` | Ledger members can read; recipient or owner confirms/reverses with matching expense balance updates |
| `invites/{token}` and `claims` | Limited invitation preview for an authenticated token holder while open; claimants submit only their own identity; owner approves |

Deletes and unspecified collection access are denied. Shared expenses require
1–8 distinct participants from the same ledger, integer nonnegative shares whose
sum does not exceed the positive expense amount, and a valid ledger payer. Eight
participants keep rule document lookups within Firestore's per-operation limit,
including a payer who is not sharing the cost; ledger member count is unrestricted.

Repayment journal entries and aggregate balances must change atomically. Tests
cover forged or reused entries, overpayment, competing receipts, duplicate
reversal, immutable expense fields, and incomplete identity approval. Approval
must update the invitation, claim, member binding, and ledger membership together.
Display names alone never grant ledger access.

Legacy rules retain their existing directory visibility: signed-in users can read
profile email and phone fields. They validate bill schema and ownership, but do
not enforce the complete split arithmetic. Shared-ledger rules enforce share
bounds and sums; calculation policy and full calendar-date validity remain client
checks (rules validate the date string shape).

Recurring/itemized coverage includes 8 items with 8 participants and 3 receipts,
immutable detail records, creator/owner authorization, and atomic occurrence
backlinks. Rules validate item shape, participant scope and total; exact per-item
rounding remains client calculation policy. Detail and receipt documents are
separate from financial records to stay within Firestore rule evaluation limits.

The cloud adapter has not been exercised here with live accounts. Existing
production documents have not been migrated. Tests and local preview **do not
deploy rules**; the new shared-ledger rules remain undeployed.

## Browser review

Start `node scripts/preview.mjs` and open
`http://127.0.0.1:2801/app.html?demo=1`. Review desktop and narrow mobile layouts,
expense entry, ledger/member creation, invitation claim/approval, partial receipt
and reversal, and statement copy/download. Check that an empty expense search
offers a clear-filter action, and that saving an expense or switching ledgers
clears previous filters. Demo changes stay in this browser's
local storage. Use a different preview port for disposable review data so that
the main demo remains clean. Browser checks complement the suites; they do not
constitute a live cloud rollout.

For authenticated two-account browser testing, see [the integration review](../docs/review/multi-session.md).
