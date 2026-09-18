# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Bill Splitter records shared expenses, explains each participant's share, and tracks repayments. The user approved adding shared ledgers, temporary members with invitation claims, partial repayments with a journal, and shareable settlement statements before reviewing the updated app.

## Users

People sharing expenses. The current implementation targets friends, roommates and trip participants as the working scenario from the accepted proposal; future emphasis on personal or family accounting remains open.

## Capabilities and Constraints

- Existing HTML/JavaScript app uses Firebase Authentication and Firestore. Preserve existing accounts and old bill records.
- New review surfaces must work with explicitly labeled sample data without requiring a real login; sample data must not write to the live project.
- Authentication provider migration and +86/WeChat/QQ login are later work.
- Repayments are recorded confirmations, not payment processing. Opening or copying a message does not mean it was sent.
- A temporary member is not an authenticated account. Claiming requires an account and ledger-owner approval in cloud mode.
- Money uses integer cents. A ledger has one currency. No cross-currency balance aggregation.
- No production deployment was requested for this review.

## Brand Commitments

The user permits a new palette suitable for the use case. Future background customization is under consideration; no fixed background or original maroon palette is required.

## Product Principles

- Explain who paid, who participated, and who still owes what.
- Preserve original financial records; corrections leave a trace.
- Make the common mobile workflow short and legible.
- Keep sample data, real account data, and invitation identity states distinguishable.
