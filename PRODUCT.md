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
- Email verification/recovery and +86/WeChat/QQ login are later work; unrestricted public registration is not ready.
- Repayments are recorded confirmations, not payment processing. Opening or copying a message does not mean it was sent.
- A temporary member is not an authenticated account. Shared-ledger claiming requires an account and ledger-owner approval.
- Any current member of an active ledger can add a named temporary participant,
  including directly while entering an expense. Adding a name does not grant
  account access; invitation creation and claim approval remain owner-only.
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
  invitation secrets. Import is not implemented; export is not a database backup.
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
