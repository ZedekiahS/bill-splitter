# Personal entry and settlement wording — 2026-11-11

Baseline: `badb6936cc7f4494ebb3033133dbf47409f149a1`.

## Changes

- English settlement statements use **Net balance ¥0.00**, replacing **Settled**
  in the member net-balance section. Two opposing unpaid debts remain listed;
  nothing is automatically offset. Actual settled expense states are unchanged.
- **My spending → Add daily expense**, with no owned active personal ledger,
  opens **Create personal ledger** with a prefilled name and currency. Activity
  dates and the ledger-type selector are omitted. **Create and add expense**
  continues directly into the first expense after the created ledger loads.
- Existing personal ledgers still open directly. Creation cancellation and
  failures retain their ordinary behavior. A successful creation followed by a
  failed read does not open an expense editor on an older ledger.
- A self-only personal entry initially shows amount, purpose, category and date,
  with notes/receipts and sharing available on demand. Payer, participant tools,
  batch names, groups and split methods stay together inside the sharing section.
  Expanding it reveals the existing editor and preview, with no field reset.
- Adding a participant expands the full shared flow. Already multi-member ledgers
  and ordinary shared-ledger creation retain their full controls. Custom-share
  drafts and pending batch/group work remain visible when restored. No financial
  defaults or permissions were changed to achieve the simpler presentation.
- Chinese/English labels and examples cover the new entry path. Changing language
  after closing and reopening preserves the local draft and user-authored text.

## Verification

**325 local tests passed** (`npm test`); **79 PostgreSQL/API tests passed** using
an isolated schema. No user ledger data was reset. `git diff --check` passed.

New regression coverage:

- Opposite unpaid 100-unit debts with zero net balances in both languages;
  actual repayments still produce the no-outstanding statement.
- Both languages: first creation → expense, prefilled self share, draft recovery
  after switching language, saved amount/date/category, and reuse without another
  ledger creation.
- Both languages: expand sharing, add a person without losing input, set 60% and
  automatically complete 40%, save, reopen with two members and full controls.
- Cancel and failed creation/retry; ordinary shared creation still opens members;
  a custom 60% self-share draft preserves its explicit amount and payer remainder;
  save-and-add-another creates two separate daily bills; failed post-create refresh
  does not target an old ledger; unfinished batch names stay visible and block
  accidental expense submission.
- Real API: self-only personal spending has no debt; a non-member cannot read the
  ledger; explicit invitation/claim permits shared participation, with matching
  account views and correct private consumption totals.

Browser checks used synthetic accounts in a separate local schema. Chinese first
creation opened the compact editor immediately. A 12.50 breakfast draft survived
closing, switching to English and reloading. **Save and add another** saved it and
opened an empty next entry. Adding Alice to a 100-unit lunch and setting the payer
to 60% saved shares 60/40. The page showed total spending 112.50, personal spending
72.50 and receivable 40; the actual stored records were checked separately.

Desktop and 390×844 viewport inspection covered both languages, disclosure controls
and save actions. The first inspection caught batch/group shortcuts outside the
collapsed sharing section; they were moved into it, and recovery coverage was
added. A confirmation pass checked the final layout. Mechanical design checks
returned no findings for the changed targets; unrelated historical design-round
metadata was left alone because this is a bounded flow refinement.

These checks do not claim physical-phone keyboard, production deployment or
long-term trial readiness. Personal ledgers retain the existing shareable member
model; personal reports and budgets remain account-private. A persistent trial
database and its backup rehearsal are separate work.
