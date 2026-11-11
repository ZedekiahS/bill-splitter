# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Bill Splitter records shared expenses, explains each participant's share, and tracks repayments. The user approved adding shared ledgers, temporary members with invitation claims, partial repayments with a journal, and shareable settlement statements before reviewing the updated app.

## Users

People sharing expenses. The current implementation targets friends, roommates and trip participants as the working scenario from the accepted proposal; future emphasis on personal or family accounting remains open.

## Capabilities and Constraints

- The HTML/JavaScript frontend uses a self-hosted Node.js API and PostgreSQL, with email/password sessions. Retained Firebase source is inactive; old accounts and records have not been migrated or deleted.
- Customer-facing previews use the same copy and interaction standards as the product. Explain test environments and verification limits in the conversation or documentation, not in extra UI banners. Isolate synthetic data from real accounts.
- Email/password login supports preconfigured one-time recovery codes. Email verification/delivery and +86/WeChat/QQ login remain later work; unrestricted public registration is not ready.
- Repayments are recorded confirmations, not payment processing. Opening or copying a message does not mean it was sent.
- A temporary member is not an authenticated account. Shared-ledger claiming requires an account and ledger-owner approval.
- Any current member of an active ledger can add a named temporary participant,
  including directly while entering an expense. Adding a name does not grant
  account access; invitation creation and claim approval remain owner-only.
- Temporary member names can be corrected by the ledger owner or original adding member. Removal requires no current/historical expense, template, payment or invitation reference; claimed accounts are excluded. The owner can deactivate used members while retaining history, balances and existing read access; active templates must be paused or edited first.
- New expense drafts support continuous participant entry and percentage remainder completion. Manually edited percentages are preserved; unedited participants split the remainder. Existing legacy drafts keep their explicit shares.
- Template-derived and successive new-expense drafts are isolated. Stale correction drafts compare with the latest version and preserve independent edits; overlapping content is reviewed explicitly. Payment locks still apply.
- New expense and repayment dates use the device calendar. Recurring due dates and schedule starts use the ledger time zone on both client and server. Existing ledgers default to Shanghai; new ledgers use the creator device time zone; stored dates stay literal.
- Money uses integer cents. A ledger has one currency. No cross-currency balance aggregation.
- Saved-expense corrections require payer/owner permission and a reason. Effective repayments lock financial fields until reversed; metadata and receipts remain editable. Conflicting versions never silently overwrite.
- Expense history preserves creation, corrections, payment confirmations and reversals with actors/times and attachment versions. Unknown legacy facts remain unknown. This is expense history, not a ledger-membership administration audit.
- Up to three private attachments per expense, each stored at up to 2 MiB. Images up to 10 MiB can be compressed locally; no OCR or server-side original-image archive.
- Unsubmitted expense, correction and template drafts use device-local IndexedDB,
  scoped by account, ledger and editor identity. They are not shared with members
  or synchronized across devices; clearing site storage removes them. Storage
  failures are shown at the form, never disguised as successful saving.
- Saved ledgers have a versioned export structure: CSV details, JSON records and
  ZIP with current/historical attachment files. Export excludes authentication and
  invitation secrets. ZIP/JSON restore creates an independent ledger after financial and attachment validation; one selected member binds to the importer, others require new invitations. Export is not a database backup.
- Only the ledger creator can archive/restore the shared ledger. Archive blocks
  all financial, member and template writes on the server while preserving read
  and export access and all unpaid balances. Restoration reveals unconfirmed
  recurring periods again, including periods that elapsed while archived.
- No production deployment was requested for this review.

## Brand Commitments

The user permits a new palette suitable for the use case. Future background customization is under consideration; no fixed background or original maroon palette is required.

## Product Principles

- Explain who paid, who participated, and who still owes what.
- Preserve original financial records; corrections leave a trace.
- Make the common mobile workflow short and legible.
- Keep sample and account storage isolated; show only identity and business states needed for the customer's current task.

- Each expense supports up to 50 participants and 8 line items. Larger ledgers default to the current member, with explicit previous-group/all/clear selection controls.
- Expense lookup combines title/note search, member/role, inclusive dates and status. Member detail exposes paid/shared/received/repaid and gross outstanding amounts.
- A real repayment can allocate to multiple expenses in oldest-date order. The receiver/owner confirms the displayed allocation; concurrent changes require fresh review. Reversal applies to the whole transfer. Opposite-direction debts are never silently netted.
- Overview shows actionable local drafts, due periods and pending invitation claims only when present. Reissuing an invite revokes earlier links; declined/revoked/expired outcomes have recovery paths.
- Joint payers, optional delegated payment entry, netting and OCR remain separately scoped enhancements rather than defects in the accepted three-stage repair plan.

- Single-expense receipt confirmation checks the displayed recipient, expense version and outstanding amount. A changed direction or balance requires explicit review while preserving amount, date and note.
- Quick outstanding and detailed status filters use one status value. New template drafts are isolated by their source expense, separate from an empty new template.
- Full-backup restore streams private attachments through temporary files and shows dates, monetary totals and member balances before creating an independent ledger. Export/import share the metadata capacity rule; deployment resource limits remain explicit.

- Batch name entry reviews reusable/new identities before one atomic command. Unique active names default to reuse; ambiguous names require a choice; intentional duplicate identities are explicit. New members never gain account access. A stale name review is rejected before any new members are written.
- Named participant groups belong to a ledger and are available across accounts/devices. Any ledger member may create a group; its creator or the ledger owner may update/delete it. Version checks prevent overwrites. Groups do not store amounts, payers or percentages, and applying one preserves existing custom numeric inputs. In item mode, a group is added only to explicitly selected items.
- Groups are included in complete JSON/ZIP exports and restored with remapped member IDs. Inactive members remain visible but unselected when applying a group. Removing an unused member removes its group references and invalidates older group versions; financial records are unchanged.


## Project and personal consumption

- An existing ledger is the project container: general shared costs, trip, meal,
  shared home, or personal daily. Optional activity dates and ongoing/ended state
  describe the activity; ending never locks late expenses or repayments. Archiving
  remains a separate owner-only read-only transition. Settings use optimistic versions.
- Categories are optional and default to uncategorized. Item categories inherit the
  expense category unless explicitly overridden. Templates, drafts, corrections,
  history and CSV/JSON/ZIP restore preserve them. Category-only changes do not unlock
  or alter financial shares or repayments.
- Project overview distinguishes total spending, my actual consumption, upfront
  payments and gross outstanding directions. Personal settlement statements contain
  only my counterparties and source bills; no opposite-direction netting is performed.
- Project reports show daily/monthly/yearly trends, categories and member consumption;
  the global My spending view adds cross-ledger totals and project comparisons. Click
  a chart to inspect its contributing expenses. Consumption uses effective expenses,
  literal expense dates, and integer-cent shares, including payer remainder. Repayments
  never create spending; reversed expenses are excluded; archived ones remain included.
- Global identity comes from authenticated uid bindings, never names. The private
  reporting endpoint projects only the caller's consumption, without other members'
  shares, receipts or history. Currency totals stay separate. Restore copies default
  to excluded; each account can save inclusion independently, including on archived
  ledgers. Preferences synchronize across devices and cannot be set for another uid.
- Personal daily is an ordinary self-owned ledger. One-member daily ledgers omit empty
  shared settlement panels; members can still be added using the existing controls.
- From My spending, first-time daily entry asks only for the personal ledger name
  and currency, then opens the first expense. The name is prefilled. Self-only
  equal-split personal entries collapse payer/participant/split controls behind
  an explicit sharing disclosure. Custom splits, pending participant work and
  multi-member ledgers remain accessible without losing the draft. Shared-ledger
  creation and member permissions use their existing flows.

## Linked refunds

- Refunds belong to an existing active expense. The original payer receives the merchant
  refund in the ledger currency; that payer or the owner records it. Each record has
  a received date, amount, beneficiary shares, optional item scope, note and actor.
- Original amounts/shares and member transfers remain unchanged. Net consumption is
  reduced on the original date and category. A whole-expense refund allocates each
  beneficiary's reduction across their remaining items; item refunds affect that item only.
- Each beneficiary and item has a remaining refundable capacity. Multiple refunds cannot
  exceed it. Integer-cent allocation conserves the exact refund amount.
- Already-paid money can create an opposite-direction return obligation. Actual returns
  are member payment records confirmed by their recipient/owner, including partial and
  batched returns. A refund reversal retains those transfers and recalculates the debt.
- Refund history locks original financial fields; metadata/categories/receipts remain
  correctable. History and full backups retain active and reversed refunds. Concurrent
  writes require review; uncertain saves replay one frozen payload and idempotency key.
- Refunds to a different recipient, cross-currency refunds, deposits and merchant credit
  are not modeled in this first version.

## Personal monthly budget

- One optional amount per account, literal calendar month and currency. Zero is an
  explicit no-spending budget; removal leaves no active budget. No automatic rollover.
- Only the authenticated account reads or changes its budgets. Shared ledger members
  and owners cannot access them. They are excluded from ledger JSON/ZIP exports.
- Spending uses the caller's net consumption across included ledgers for the whole
  selected month. Classification/project chart filters do not narrow the budget.
  Repayments and returns never change consumption; refunds adjust the original month.
- My spending shows the budget, spent and remaining/over amount. Spent opens precisely
  matching history. New expense entry gains no budget fields or extra steps.
- Saves synchronize through the existing revision polling. Stale versions require
  explicit review. Unknown writes retry their original payload/key; navigation during
  a failed save preserves the draft and restores usable controls.
- Deposits are excluded by the user's decision. Category/project budgets, rollover,
  forecasting and budget notifications are outside this lightweight first release.
