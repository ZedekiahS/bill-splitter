# Bill Splitter

A web app for shared expenses, bill splitting, and repayment records. This
standalone repository preserves the original CSSE280 project and its vendor
license notices, with a new shared-ledger interface built in HTML, CSS, and
JavaScript.

## Expense entry improvements

- Add several temporary participants without closing the entry panel; find existing
  names before creating another. Small ledgers select everyone; ledgers over eight
  members initially select only the signed-in member. Each expense supports up to 50 participants; the previous group can be selected explicitly.
- Percentage splits start equal. Editing one of two shares completes the other;
  with more participants, unedited shares divide the remainder. Manual inputs survive
  mode switches and draft recovery. Invalid or over-100 totals are not normalized.
- Preview rows show final consumption, including the payer's unallocated remainder.
- Ordinary drafts, each source template and successive entries have separate identities.
  Stale correction drafts show a comparison and merge independent changes; overlapping
  fields require review. Effective payments keep financial fields locked.
- Saving keeps the current view, search and filter. Save-and-add-another retains the
  selected participants and clears expense-specific fields.
- Temporary members can be renamed by the owner or their original adding member;
  only unused members without expenses, history references, templates or invitations
  can be removed. Claimed accounts cannot be edited through this flow.
- New expense/repayment dates follow the device calendar; recurring periods use the shared ledger time zone. Saved dates do not shift.

Verification details: [entry flow review](docs/review/entry-flow-2026-11-06.md).

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
verification and email recovery delivery are required before unrestricted public
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
- Shared ledgers update automatically while the page is visible, checking revisions
  about every three seconds and fetching data only when something changes. Returning
  to the page or reconnecting checks immediately. Input drafts are preserved; open
  repayment balances, expense details and settlement statements update as well.
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
  PDFs must each fit within 2 MiB. Smaller images retain their original bytes.
  Select files, drop them, or paste screenshots; preview images with zoom/fit and
  download attachments. Templates reuse items and notes, not receipts.
- The payer or ledger owner can supplement/correct a saved expense with a reason.
  Effective repayments lock the amount, payer and splits until reversed.
  Concurrent edits reject stale versions and retain the input draft.
- Expense history records creation, before/after corrections, receipts and reversals
  with actor and time. Replaced attachments remain privately accessible in history.
  Legacy entries show only recorded facts; missing actors are not invented.
- Temporary named members who can later claim their identity through an invite,
  subject to the ledger owner's approval. A matching name never grants access.
  Any existing member can add a temporary participant while entering an expense,
  preserving the current form and split inputs.
- Partial repayments confirmed by the recipient or ledger owner. Reversals leave
  a journal entry and restore the outstanding amount. Expenses with effective
  repayments cannot be reversed until those repayments are reversed.
- A settlement statement that can be copied or downloaded as text. The app does
  not send it, transfer money, or treat the statement as a payment receipt.
- Incomplete expenses, corrections and templates recover from device-local drafts,
  including split inputs and attachments. Drafts are isolated by account and ledger.
- Members can download expense CSV, ledger JSON or a complete ZIP containing
  financial records, history and attachment files. The creator can archive a ledger
  as read-only and restore it later; archiving never cancels outstanding debt.
  See [the versioned export format](docs/ledger-export-format.md).

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

All 202 local tests and 52 PostgreSQL API tests pass in the November 7 reliability follow-up.
They cover money, drafts/conflicts, selection and localization, batch repayments,
member lifecycle, invitations, time zones, ZIP/JSON restoration and single-use
account recovery. API suites run sequentially against an isolated disposable
schema; never run reset fixtures against the phone-preview data.
Legacy emulator suites remain for historical regressions. See
[tests/README.md](tests/README.md) for commands, coverage and limits.

## License

See [LICENSE](LICENSE). Existing vendor license headers are preserved in `public/`.

For three-account browser workflows, simulated coordination, failures and coverage
limits, see [the full acceptance review](docs/review/full-acceptance-2026-10-30.md).
Automatic synchronization is covered in [the follow-up review](docs/review/auto-sync-2026-10-30.md).

Expense corrections, history and attachment workflows are documented in
[the October 31 review](docs/review/expense-history-2026-10-31.md).

Draft recovery, export and ledger archiving are covered in
[the November 2 review](docs/review/drafts-export-2026-11-02.md).

## Lookup, settlement and recovery

- Search titles and notes; combine member/role, date range and status filters.
  Member accounts show total shares, advances, repayments and outstanding amounts.
- Confirm one transfer across multiple bills with an oldest-first allocation preview.
  Server checks the reviewed versions, prevents overpayment and reverses the whole
  transfer together. Opposite debts remain separate until explicitly repaid.
- The owner can deactivate/restore members while preserving previous records and
  balances. Reissued links revoke old invites; requests can be declined or revoked.
- Overview links to existing drafts, due recurring bills and pending join requests.
- ZIP/JSON import validates records and restores a separate ledger. Choose your own
  member identity; other people must be invited again. Missing attachment files block
  incomplete recovery. ZIP files stream to private temporary storage; attachments are
  processed separately from JSON metadata. Export and import share a 64 MiB metadata
  limit, while each receipt retains its 2 MiB limit. Import previews show dates,
  expense totals, outstanding amounts and member balances.
- New accounts receive a one-time recovery code; existing accounts can generate one
  using the current password in account settings. Password reset consumes the code
  and revokes all sessions. Keep the code outside the app. Email/SMS recovery is not
  configured, and an account without its password or saved code cannot self-recover.

See [the complete follow-up checklist and evidence](docs/review/flow-completion-2026-11-06.md).

The [November 7 reliability review](docs/review/reliability-2026-11-07.md) covers stale single-payment protection, full-backup round trips, unified status filters and source-specific template drafts.


### 2026-11-07：连续记账与成员选择

- 保存并继续记保留垫付人、日期、参与人、分摊方式；按比例保留比例及手动/自动状态。金额、用途、备注、附件和旧项目不会带入下一笔。
- 添加参与人时，回车复用唯一同名成员；多个同名成员须明确选择，也可主动另建同名成员。
- 逐项分摊新增或选择成员后，可就地选择其消费项目并看到承担金额；未分配时须选择项目或明确暂不分摊。
- 每人的比例标出手动或自动，可单独恢复自动分配，其他人的手动设置保持不变。
- 手机默认收起成员、身份、日期筛选；收起后保留生效条件摘要，状态选择始终可见。

验证记录：[连续记账体验复核](docs/review/entry-flow-2026-11-07.md)。


### 2026-11-07：批量名单与常用组合

记一笔中新增“批量添加”和“常用组合”：

- 支持换行、逗号、顿号、分号、制表符分隔姓名；保留英文姓名内部空格。先核对复用/新建/同名歧义，也能取消不需要的人，再一次确认。
- 批量添加失败不留下半份名单；网络重试沿用幂等请求，并发新建同名成员需要重新核对。
- 将当前参与人命名保存到账本，在其他设备或成员账号上使用。支持替换或追加本笔参与人，以及编辑名称、编辑成员和删除组合。
- 普通成员只能修改自己创建的组合，管理员可管理账本内组合。组合更新采用版本核对，删除组合保留成员和账单。
- 逐项分摊先选择消费项目，再将名单或组合加入这些项目。原有项目参与人保留；其他项目不受影响。
- 未确认名单会阻止直接保存账单，输入随草稿保留。完整备份包含组合并支持恢复；旧备份仍可导入。

验证记录：[批量名单与组合复核](docs/review/participant-groups-2026-11-07.md)。
