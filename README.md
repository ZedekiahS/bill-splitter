# Bill Splitter

A web app for shared expenses, bill splitting, and repayment records. This
standalone repository preserves the original CSSE280 project and its vendor
license notices, with a new shared-ledger interface built in HTML, CSS, and
JavaScript.

## Try the updated app

Run from the repository directory with Node 20+:

```powershell
node scripts/preview.mjs
```

Open [the local demo](http://127.0.0.1:2801/app.html?demo=1). No login, package
installation, or Firebase connection is needed for this mode. The server binds
only to the local computer. Set `BILL_SPLITTER_PORT` to choose another port.

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
- Equal, percentage, or exact-amount splits with a preview before saving; the payer can also
  participate. Each expense supports up to **8 people sharing the cost**. This
  limit does not restrict the number of members in a ledger.
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

## Accounts and cloud data

`app.html` without `?demo=1` uses Firebase Authentication and Cloud Firestore.
The login page retains email/password and the existing Rosefire entry for old
accounts. Authentication migration, +86 phone, WeChat, and QQ login are deferred.
The new interface's account menu provides **查看原有独立账单** for the original
bill history; existing bills have not been migrated into shared ledgers.

The local preview redirects `/__/firebase/` SDK/config requests to the original
`shex-billsplitter.web.app` host. Consequently, signing into cloud mode can use
real account data; it is not an emulator. The included `.firebaserc` also records
the original project association. Configure your own project and Firebase
Hosting environment before making a separate deployment.

The shared-ledger cloud adapter and security rules are implemented, but **the new
rules have not been deployed**. Local tests do not establish a production rollout
or a live-account end-to-end test. The working demo is the review entry point.

## Project layout

- `public/app.html`, `public/scripts/app.mjs`, `public/styles/app.css`: new UI.
- `public/scripts/ledger-core.mjs`: money, shares, balances, and settlement text.
- `public/scripts/ledger-store.mjs`: isolated demo storage and Firebase adapter.
- `public/index.html`: account login; the original bill pages remain in `public/`.
- `firestore.rules`: original profiles/bills plus shared ledgers and invitations.
- `scripts/preview.mjs`: dependency-free local preview server.
- `tests/`, `firebase.test.json`: calculations and isolated emulator tests.
- [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md): product scope and UI decisions.

## Tests

```powershell
node tests/bill-calculations.test.mjs
node tests/ledger-core.test.mjs
node tests/i18n.test.mjs
node tests/expense-search.test.mjs
```

All 117 local tests pass: 65 original calculation regressions, 42 shared-ledger
calculation/storage tests, 6 localization regressions, and 4 expense-search
regressions. Separate emulator suites cover 32 original permission
cases and 31 shared-ledger permission cases. See [tests/README.md](tests/README.md)
for commands, coverage, and limits. Neither tests nor preview deploy rules or
modify a live service.

## License

See [LICENSE](LICENSE). Existing vendor license headers are preserved in `public/`.
