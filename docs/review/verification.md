# Shared-ledger review — 2026-09-18

This is a local implementation review. No production deployment, live account
mutation, real payment, or message to another person was performed.

## Verified behavior

- Browser demo: create a shared ledger, add a temporary member, switch ledgers,
  and retain the selected ledger after a browser refresh.
- Record a CNY 120.01 expense: equal shares 30.01 + 30.00 + 30.00 + 30.00.
- Record 10.00 against a 30.00 share: 20.00 remains. Reverse the receipt: 30.00
  remains again, with the original receipt and reversal both retained.
- Create a local demo invitation, submit a claim as the demo visitor, approve as
  the owner, and open the approved ledger as that visitor. The existing named
  member and their amounts remain intact.
- Preview and copy the settlement statement; verify the copied amount and title.
- Desktop overview and entry dialog at 1280 × 800; mobile overview and scrollable
  entry dialog at 390 × 844. The bottom cancel/save actions were reached by
  scrolling. At 320 px, document scroll width equals client width after fixing
  the root minimum-width overflow.
- Login layout loads without console errors. No real sign-in was attempted.
- No warnings/errors in the inspected demo and login browser logs.

## Automated checks

| Suite | Passing cases |
| --- | ---: |
| Legacy bill calculation/date regressions | 65 |
| Shared-ledger calculations and demo-store behavior | 26 |
| Legacy Firestore permission tests | 32 |
| Shared-ledger Firestore permission tests | 31 |

The rule suites ran against loopback Firestore emulators and synthetic demo
projects, including concurrent repayment and atomic member-claim checks. They do
not establish live Firebase deployment or real-account end-to-end behavior.
JavaScript syntax checks and `git diff --check` passed.

## Visual evidence and limits

- [Desktop overview](desktop-overview.jpg)
- [Desktop entry dialog](desktop-entry.jpg)
- [Mobile overview](mobile-overview.jpg)
- [Mobile entry dialog](mobile-entry.jpg)
- [Mobile entry actions after scrolling](mobile-entry-actions.jpg)
- [Login page](login.jpg)

One fresh screenshot review found no blocking visual issue. The mechanical
design detector returned no findings but ran in degraded regex mode because its
parser modules were unavailable; this is not a computed contrast audit. The
session used the user-approved brief and direct implementation, without a
separately approved image comp, so no comp/build-phase approval is claimed.

The user-facing preview on port 2801 retains the original synthetic demo data.
Mutation checks used a separate origin on port 2802. Demo invitations work only
with data in that browser and origin. Real shared use requires authentication
and deployment of the new rules. Background customization remains future work;
the palette and surface tokens are separated for that extension.
