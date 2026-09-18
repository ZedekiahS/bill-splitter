# Bill Splitter

A web app for recording shared expenses, splitting bills, and tracking repayments.
This repository preserves the standalone project extracted from a CSSE280 personal
coursework repository, including its existing third-party license notices.

## Current features

- Email/password sign-in and the original Rosefire integration.
- Create bills with equal or percentage-based splits.
- View bill history and outstanding balances.
- Let the original payer edit a bill and confirm repayments.
- Open email/SMS reminder drafts.

The app uses HTML, CSS, JavaScript, Firebase Authentication, and Cloud Firestore.
Phone and guest sign-in buttons are present in the original interface but are not
implemented yet. Authentication changes are future work.

## Project layout

- `public/`: pages, styles, and client-side scripts.
- `firestore.rules`: access rules for profiles and bills.
- `firebase.json`: Firebase project hosting and database configuration.
- `firebase.test.json` and `tests/`: isolated Firestore permission tests.

## Local development

The pages use Firebase Hosting's reserved `/__/firebase/` SDK and initialization
URLs. Use Firebase's local hosting tools with your own Firebase project configured
before testing account or database operations. A plain static server alone does
not provide these reserved URLs.

```sh
firebase use --add
firebase serve --only hosting
```

The included `.firebaserc` records the original project association. Select your
own project before using the app as a separate deployment.

## Permission tests

The current rules were verified with 32 local emulator test groups. They restrict
bill reads to the payer and participants, and bill edits to the original payer.
Profiles can only be written by their owners; the signed-in participant directory
remains readable for the existing selection and reminder flows.

See [tests/README.md](tests/README.md) for the test commands and precise boundaries.
Tests use a fixed local `demo-bill-splitter-permissions` emulator project and do not
need production credentials or npm test dependencies.

Saving this repository does not deploy its Firestore rules or change a live service.

## License

See [LICENSE](LICENSE). Existing vendor license headers are preserved in `public/`.
