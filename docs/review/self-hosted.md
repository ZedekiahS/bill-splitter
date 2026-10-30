# Self-hosted backend verification

Verified 2026-10-29 (local workstation date), Node.js 24.22 / PostgreSQL 18.
The main application now uses its own API and database, not the retained
Firebase adapter. No public service was deployed and no Firebase data migrated.

## Automated checks

- `npm test`: 155 existing calculation, storage, localization, receipt, recurring
  and navigation regressions passed after extracting shared domain logic.
- `npm run test:api`: 13 integration tests passed against a dedicated PostgreSQL
  database. Cases cover password hashing, sessions/logout/expiry, login limits,
  HTTPS production origins and cookies, registration control, CSRF, request size,
  account isolation, claim approval, payer restrictions, concurrent idempotency,
  overpayment races, reversals, item arithmetic, private files, recurring duplicate
  prevention and persistence after creating a new server instance.
- `git diff --check`: no whitespace errors.

The API suite uses actual PostgreSQL transactions and Fastify injection, not
browser mocks. It resets only a loopback database explicitly ending `_test`.

## Two-session browser flow

Two separate cookie hosts (`127.0.0.1:2806` and `localhost:2806`) shared one
local API/database. Different ports alone would not isolate session cookies.
Both accounts and the PDF were synthetic, created for this verification.

1. Register the owner, create an empty ledger and a temporary member.
2. Open the invitation in the second session. Sign-up preserves the invitation
   URL and returns to the claim form. Before approval, ledger data is unavailable.
3. Submit the claim, approve from the owner session, then refresh the member
   session. Both see the same ledger; changing Chinese/English retains access.
4. Member records a CNY 320 itemized expense: a 300 room split equally plus a 20
   breakfast allocated only to the owner. The owner owes 170; the payer consumes
   150. A note and synthetic PDF are uploaded with the transaction.
5. Owner refreshes and sees the same items/note/amounts. The PDF downloads through
   the authenticated receipt endpoint, and its SHA-256 matches the source file.
6. Owner records a partial repayment of 100. Both sessions show 70 outstanding.
7. Member saves the expense as a monthly template; reload shows a due occurrence.
   Skipping the occurrence clears it without increasing spending.
8. Main preview port 2801 is switched from the static preview server to the real
   API. Existing database data and the owner's session remain accessible there.

This is two independent authenticated browser sessions on one workstation, not
a physical-phone, mainland-network, SMTP, public HTTPS or cloud deployment test.
Production packaging and deployment instructions are provided but the container
image has not been built on this workstation. Email verification/recovery and
WeChat/QQ/phone binding remain future integrations. See [deployment details](../self-hosting.md).
