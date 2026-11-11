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

First-time daily entry creates a personal ledger and immediately opens the first
expense. A self-only personal ledger starts with sharing controls collapsed;
custom splits and multi-member ledgers keep their full controls. English settlement
exports label zero net balances as **Net balance**, without implying opposing debts
have been paid. [Personal entry and wording review](docs/review/personal-entry-2026-11-11.md).

## Linked merchant refunds

Record a partial, full or repeated refund from its original expense. Select the
whole expense or one item, check the suggested distribution, or enter each person's
refund share. Refunds currently use the ledger currency and must have reached the
original payer. Only that payer or the ledger owner records/reverses them.

Original spending and actual member transfers remain intact. Net consumption and
reports decrease on the original expense date/category. If members already paid,
the remaining transfer can reverse direction: the original payer returns their
excess payment, confirmed by the recipient or owner. Partial payments and successive
refunds recalculate these directions without silently offsetting separate expenses.

Expense detail shows original spending, total refunded, net spending, refund history
and pending returns. Corrections preserve refund history; refund reversal requires a
reason. Complete backups include refunds and return transfers. Unknown save results
retain the original payload and idempotency key when retrying or reopening the form.

Verification: [linked refunds review](docs/review/linked-refunds-2026-11-10.md).

## Personal monthly budget

In **My spending**, optionally set a budget for each month/currency. Only you can
see it; it is stored separately from shared ledgers. The budget compares with your
actual net share across included ledgers, not everything you paid upfront. Refunds
adjust the original spending month; member repayments do not change consumption.
Click **Spent** to open the matching monthly history. Budgets can be edited or
removed, and zero is supported. There is no rollover, category budget or deposit flow.

Budget settings synchronize across sessions with version conflicts and idempotent
retry protection. They are excluded from shared ledger exports; include the
`bs_personal_budgets` table in full database backups. Run the normal database
migration when updating an existing installation.

Verification: [monthly budget review](docs/review/monthly-budget-2026-11-10.md).

Recovery follow-up: [batch receipt retries, refund backups and budget navigation](docs/review/refund-budget-recovery-2026-11-10.md).
Batch receipts retain the same pending operation across dialog/tab reloads, including
fully settled transfers. Valid overpayment states and historical snapshots can be
restored. Budget completion updates its current region without discarding unfinished
report date inputs.

Further verification: [pending receipt access and budget response ordering](docs/review/pending-entry-budget-order-2026-11-10.md).
Pending receipt verification remains accessible even if its debt direction disappears.
Late budget reads retain newer versions, including removed and zero budgets.
Explicit conflict reloads also use that accepted version for their review notice
and next save, preserving the amount draft and unfinished report dates.
See [budget reload consistency and feedback](docs/review/budget-reload-context-2026-11-10.md).

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
  participate. Each expense supports up to **50 people sharing the cost**. This
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

### 2026-11-07：收款重试与编辑恢复

- 收款结果未知时保留原请求及幂等键，核实结果不会随新余额重复记账；当前标签页重载后可继续核实。
- 切换逐项分摊保留手工总额和未完成的人员分配，草稿可恢复。
- 已有组合编辑纳入草稿，保存账单前需保存或明确放弃修改；并发变化需核对。
- 组合改名保留原有停用成员，应用时仍只选择活跃成员。

验证记录：[收款重试与编辑恢复复核](docs/review/retry-and-editor-recovery-2026-11-07.md)。

### 2026-11-09：恢复与冲突边界

- 组合冲突后改回原名仍需明确核对，不会自动覆盖远端新增成员。
- 全额收款后，账单详情保留当前账号尚未完成的核实入口。
- 首次从逐项切换到其他方式，金额和份额采用一致来源；原手工草稿仍保留。
- 组合被删除后直接更新会显示准确状态，保留本地编辑。

验证记录：[恢复与冲突边界复核](docs/review/recovery-boundaries-2026-11-09.md)。


### 项目、分类与个人消费（2026-11-09）

账本现在可用于旅行、聚餐、合租或个人日常，支持可选活动日期、活动结束状态。
结束活动后仍能补账与还款，归档是独立操作。总览区分项目总开销、我的实际消费、
垫付和待收待付；结算页默认显示我的往来，可展开来源并复制个人结算单。

账单及逐项消费支持分类，条目默认沿用账单分类。分类随草稿、模板、更正历史与
CSV/JSON/ZIP 备份保存，旧账单保持未分类。项目统计提供趋势、分类、成员承担与
图表明细入口；“我的消费”跨账本统计本人实际承担的消费，支持时间、分类、账本、
币种筛选及个人日常入口。归档保留历史消费，撤销排除，还款不重复计入消费；
恢复副本默认不纳入，统计范围选择随账号同步。不同币种不会直接相加。

验证、操作路径及限制见 [本轮验收记录](docs/review/project-consumption-2026-11-09.md)。
净额抵扣、多人减少转账方案与 OCR 不在本轮实现范围内。

“我的消费”现在提供概览与按月分组的历史明细，可查看月度同期对比、分类变化及年度回顾；图表和对比金额均可打开对应记录。未结束的月份/年份按同期比较，上期没有记录时不计算变化比例。相关日历、过滤、分页与界面回归后，本地测试共 248 项通过。
