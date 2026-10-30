# Two-account browser integration review

> Historical Firebase-emulator review. The active backend is now PostgreSQL; see [current verification](self-hosted.md).

Verified on 2026-10-29 using the application UI and its cloud store adapter.
Alice and Bob signed in with separate browser origins (ports 2804 and 2805),
sharing one local Firebase Authentication and Firestore emulator project. These
were authenticated backend writes, not demo localStorage writes. This is not a
physical-device, public-network, or production Firebase acceptance test.

## Reproduce

Start from the repository directory with Node 20+, Firebase CLI, and Java 23:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
firebase emulators:start --only 'auth,firestore' --project demo-bill-splitter-integration --config firebase.integration.json
```

Once both emulators are ready, run in a second terminal:

```powershell
node scripts/integration-preview.mjs
```

The harness serves the unchanged product pages on loopback ports 2804/2805 and
creates synthetic accounts `alice@example.test` and `bob@example.test`, with
password `Local-Test-Only-280!`. These credentials are for the local emulator
only. Sign in through each page's email form. When moving an invitation between
these clients, change its port from 2804 to 2805 to retain Bob's separate session.
For real devices, the invitation uses the same public app origin instead.

The harness substitutes Firebase SDK 8.10.1 at the SDK request paths because the
production SDK 7.18.0 does not provide Auth emulator support. The namespaced API,
application source, cloud adapter and repository security rules are used. This
does not prove production SDK/network compatibility. No emulator toggle, account
switcher, or technical banner is added to the product. Stop both processes after
testing; the emulator data is disposable and is not exported.

## Observed workflow

1. Alice creates a CNY ledger and a temporary member Bob. Bob initially sees no
   shared ledger, then follows the invitation and submits an identity claim.
2. Alice refreshes and approves. Bob refreshes and gains access. After the fix,
   switching language keeps the ledger and navigation; the consumed invitation
   is removed from the URL.
3. Bob creates two expense items: 100.01 shared by both, and 30.02 for Alice.
   Result: total 130.03, Bob 50.01, Alice 80.02. Bob can only select himself as
   payer. Notes and a synthetic PDF are attached.
4. Alice refreshes and opens the same expense, sees its items and note, and
   downloads the PDF. The downloaded bytes match the original fixture.
5. Both open repayment forms with 80.02 outstanding. Bob records 30.00; Alice's
   stale 80.02 submission is rejected without a duplicate journal entry.
6. Repeat with 50.02 outstanding and Bob recording 10.00. After the fix, Alice's
   rejected form updates the displayed remainder to 40.02 while retaining her
   entered 50.02. No automatic payment retry occurs.
7. Alice records the actual remaining 40.02. Bob refreshes and sees a settled
   ledger and three receipts (30.00, 10.00, 40.02). Bob reverses 10.00; Alice
   refreshes and sees 70.02 repaid and 10.00 outstanding.
8. Bob stores the itemized expense as a monthly template. Both accounts open
   the same due occurrence. Bob confirms it; Alice's later confirmation is
   rejected as already handled. After refresh there are exactly two expenses:
   the original and one recurring occurrence.

Updates in this version are retrieved through the app's Refresh action or page
reload. This review does not claim automatic real-time UI synchronization.

## Fixes and regression coverage

- Refresh on an invitation now reloads that invitation's status. Approval clears
  the invitation context; pending approval remains in the invitation flow.
  Previously, refresh loaded ledger data but left stale invitation state, so a
  language change could return an approved member to the waiting screen.
- A rejected repayment now refreshes the outstanding amount shown in its form,
  preserving user input and the original error. Previously the old amount stayed
  visible even when the backend correctly rejected overpayment.

`node --test tests/invitation-navigation.test.mjs` exercises the actual app event
handlers with controlled DOM/storage boundaries. All three regressions were
observed failing before the corresponding fixes and passing afterward. The
targeted localization, ledger core, feature storage and navigation run passed
65 tests. No rules or live cloud services were deployed or modified.

## Remaining live acceptance requirements

The existing production-mode browser had no signed-in account. Firebase CLI
recognized a stored login but failed to list projects. Live testing still needs
an accessible test Firebase project with the shared-ledger rules installed,
two usable accounts, and two actual devices/browser environments. Do not treat
the local result as confirmation of that deployment or of mobile-network access.
