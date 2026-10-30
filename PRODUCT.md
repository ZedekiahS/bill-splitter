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
- Money uses integer cents. A ledger has one currency. No cross-currency balance aggregation.
- No production deployment was requested for this review.

## Brand Commitments

The user permits a new palette suitable for the use case. Future background customization is under consideration; no fixed background or original maroon palette is required.

## Product Principles

- Explain who paid, who participated, and who still owes what.
- Preserve original financial records; corrections leave a trace.
- Make the common mobile workflow short and legible.
- Keep sample and account storage isolated; show only identity and business states needed for the customer's current task.
