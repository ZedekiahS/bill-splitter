# Bill Splitter

A web app for shared expenses, bill splitting, and repayment records. This
standalone repository preserves the original CSSE280 project and its vendor
license notices, with a new shared-ledger interface built in HTML, CSS, and
JavaScript.

## Run the application

The frontend now uses a self-hosted Node.js API and PostgreSQL. Normal account
and shared-ledger operation does not require Firebase, Rosefire or Google SDKs.
Use Node.js 22+ and a dedicated PostgreSQL database (validated on Node 24 / PostgreSQL 18):

```powershell
npm ci
# Copy .env.example to .env and configure DATABASE_URL / PUBLIC_ORIGINS.
npm run db:migrate
npm start
```

Open [Bill Splitter](http://127.0.0.1:2801/index.html) and register with a name,
email and password. Email is currently an unverified login identifier; email
verification and password recovery are required before unrestricted public
registration. WeChat, QQ and phone login are deferred. See [deployment and backup
instructions](docs/self-hosting.md). No public deployment or old account migration
is performed by updating this repository.

The optional [local experience](http://127.0.0.1:2801/app.html?demo=1) is independent
of registered accounts. `node scripts/preview.mjs` is retained only for frontend
review and cannot serve the new API.

The demo starts with illustrative roommate, trip, and dinner ledgers. Changes
persist in this browser's `localStorage` under
`bill-splitter-ledger-demo-v1`; different browser origins, including ports, have
separate copies. Demo invitations work only in the same browser and origin.
They demonstrate the claim and approval flow, not cross-device sharing.

## Shared-ledger features

- Separate ledgers for groups or activities, each using CNY or USD.
- Overview, searchable expense list, settlements, and member management.
- Expense search supports Chinese text composition and shows matching results.
  Empty results offer a clear-filter action; saving an expense or switching
  ledgers clears previous filters so the relevant entries remain visible.
- Chinese/English interface and settlement statements, with a remembered language
  choice shared by the app and sign-in page. Entered ledger data stays unchanged.
- Equal, percentage, exact-amount, or itemized splits with a preview before saving; the payer can also
  participate. Each expense supports up to **8 people sharing the cost**. This
  limit does not restrict the number of members in a ledger.
- Reusable expense templates, with optional weekly, monthly, or yearly repeats.
  Opening or refreshing a ledger generates due drafts; confirmation records the
  expense once. Skip an occurrence, pause a schedule, or archive/restore a template.
  Monthly schedules preserve their original day across shorter months. There is
  no background scheduler or notification service.
- Up to 8 items per expense, each shared by its selected participants, plus a note
  of up to 1,000 characters and up to 3 JPG/PNG/WebP/PDF receipts. Images up to
  10 MB are accepted and compressed locally when needed; stored receipts and
  PDFs must each fit within 200 KB. Templates reuse items and notes, not receipts.
- Temporary named members who can later claim their identity through an invite,
  subject to the ledger owner's approval. A matching name never grants access.
- Partial repayments confirmed by the recipient or ledger owner. Reversals leave
  a journal entry and restore the outstanding amount. Expenses with effective
  repayments cannot be reversed until those repayments are reversed.
- A settlement statement that can be copied or downloaded as text. The app does
  not send it, transfer money, or treat the statement as a payment receipt.

Amounts use integer cents. Percentage inputs support two decimal places;
unassigned percentages are covered by the payer and rounding preserves the
assigned total. Ledgers never combine balances across currencies.

## Accounts and shared data

The API uses opaque, revocable HttpOnly session cookies and scrypt password
hashes. Server-side checks enforce membership, invitation approval, payer and
recipient permissions, and split arithmetic. PostgreSQL ledger-row transactions
and idempotency keys protect concurrent writes. Receipts are private downloads
available only to members, stored with the database for consistent backup.

Stable internal user IDs are separate from login identities. No automatic
name/email merging occurs. The old Firebase adapter and rules remain historical
source; current login and API do not use them. Old HTML pages are unavailable
through the new server, and existing data has not been converted automatically.

## Project layout

- `public/app.html`, `public/scripts/app.mjs`, `public/styles/app.css`: new UI.
- `public/scripts/ledger-core.mjs`: money, shares, balances, and settlement text.
- `public/scripts/ledger-domain.mjs`: shared server/local business rules.
- `public/scripts/api-store.mjs`, `login.mjs`: same-origin API and session login.
- `server/`: authentication, PostgreSQL transactions, API, schema and entry point.
- `Dockerfile`, `deploy/`: production packaging and reverse-proxy example.
- `public/scripts/ledger-store.mjs`: local storage and retained legacy adapter.
- `public/index.html`: account login.
- `firestore.rules`: original profiles/bills plus shared ledgers and invitations.
- `scripts/preview.mjs`: dependency-free local preview server.
- `tests/`, `firebase.test.json`: calculations and isolated emulator tests.
- [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md): product scope and UI decisions.

## Tests

```powershell
npm test
# Set TEST_DATABASE_URL in .env.test to a disposable local database ending _test.
npm run test:api
```

All 161 local tests pass: 65 original calculation regressions, 42 shared-ledger
calculation/storage tests, 7 localization regressions, 4 expense-search
regressions, 21 recurring/item/attachment checks, 13 feature-storage checks,
3 shared-session UI regressions, and 6 API-client retry/error checks.
The 29 PostgreSQL API tests exercise real authenticated transactions, permissions,
concurrency and private files, including 16 scenarios through an actual HTTP
listener. They reset only their dedicated test database and run sequentially.
Legacy emulator suites remain for historical regressions. See
[tests/README.md](tests/README.md) for commands, coverage and limits.

## License

See [LICENSE](LICENSE). Existing vendor license headers are preserved in `public/`.

For three-account browser workflows, simulated coordination, failures and coverage
limits, see [the full acceptance review](docs/review/full-acceptance-2026-10-30.md).
