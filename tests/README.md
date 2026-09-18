# Firestore permission tests

These tests exercise the real Firestore emulator with Node's built-in test runner.
No npm dependencies or live Firebase credentials are required. Install Node 20+
and the Java version required by your Firebase CLI before running them.

From the `Project` directory, run:

```powershell
firebase emulators:exec --only firestore --project demo-bill-splitter-permissions --config firebase.test.json "node tests/firestore-rules.test.mjs"
```

On this Windows workstation, the default `java` is Java 8, while JDK 23 is already
installed. Select it for the current terminal before using the CLI command:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

If a Firestore emulator is already running locally:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8280'
node tests/firestore-rules.test.mjs
```

The suite loads `firestore.rules` and clears **only the emulator database for
`demo-bill-splitter-permissions`** before seeding synthetic fixtures. It rejects
non-loopback emulator addresses. Test accounts and bills never use the production
project. Do not run concurrent suites against the same demo project.

The fixture seeding token `owner` and unsigned test-user tokens are supported by
the Firebase emulator only. Actual access assertions use the test-user tokens or
no token; they do not use the administrative fixture token.

## Current permission model

| Resource | Read | Create or update | Delete |
| --- | --- | --- | --- |
| `users/{uid}` | Signed-in users | Only that uid, with the known profile fields | Denied |
| `bills/{id}` | Original payer or a listed debtor | Create as oneself; update only as the original payer | Denied |
| Other collections and all subcollections | Denied | Denied | Denied |

The original payer also confirms repayments, matching the existing UI. Updates
cannot change `payerUid`, `createdAt`, or `status`, or add unknown fields.
Creation and update timestamps use server timestamps. Writes check required
fields and basic types, unique participants, matching `shares` / `paid` keys,
and boolean payment flags.

The signed-in user directory intentionally preserves the existing participant
picker and reminders: profile fields, including email and phone number, remain
readable by other signed-in users. This change does not make contacts private to
bill members. That would require a separate directory/contact data model and UI
change.

Rules do not enforce the full split-amount arithmetic in this change. Amount
rounding and date conversion fixes remain separate work. Existing production
documents and deployed rules have not been inspected or migrated; older documents
outside the current application's schema may need correction before editing.

Running these tests or the local preview does **not** deploy the rules. Production
keeps its current rules until an explicit rules deployment.

References:

- [Firebase rule conditions and query behavior](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Firebase field validation](https://firebase.google.com/docs/firestore/security/rules-fields)
- [Testing with the Firestore emulator](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Firebase SDK emulator test-token format](https://github.com/firebase/firebase-js-sdk/blob/main/packages/util/src/emulator.ts)
