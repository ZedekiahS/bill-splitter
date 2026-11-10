# Budget reload consistency and feedback — 2026-11-10

Baseline: `591d576715d1daa32709628a0816e44c4b5b355b`.

## Problem and change

An explicit **Load latest budget** request could finish after navigating away and
back. The returned version 2 was correctly prevented from replacing the visible
version 3 card, but the old handler still set the editor's expected version and
review notice from version 2. Saving the retained amount then caused another 409.

Budget responses now pass through the currently bound report's version merge
before the handler derives the review baseline. The card, successful reload
notice, `expectedVersion` and `hadBudget` all use the accepted result. Save
completion uses the same acceptance path. Only the budget region is refreshed;
unfinished report dates and their focus are retained.

Interaction changes:

- Reload says **Loading…**, disables repeated actions and marks the form busy;
  it no longer incorrectly says a save is in progress.
- A failed reload leaves the amount intact and offers the reload action again.
- Successful review is a neutral status message near the amount, not an error.
  It states the current saved budget and that the user's input is retained.
- The success notice stores data rather than translated text, so switching
  Chinese/English translates it without changing the draft or review version.
- No development or verification explanations were added to the product page.

## Verification

`npm test`: **314 passed**. PostgreSQL isolated API suite: **78 passed**.

The added application navigation regressions first failed with expected version
2 instead of 3. The language regression first failed with a Chinese notice after
switching to English. Both pass with the changes.

Controlled sequence, covered in the actual application hash-navigation harness
and in real PostgreSQL API sessions with the budget UI mounted:

1. A sees 1500/version 1 and enters 1800.
2. A second session saves 2000/version 2; A's save receives 409.
3. A starts explicit reload; its version 2 response is held.
4. The second session saves 1000/version 3, removes the budget/version 3, or
   sets it to zero/version 3 (three independent cases).
5. A returns to the report and receives version 3; starts editing a custom date.
6. Release the older reload response. Card/notice/review baseline remain version
   3, `hadBudget` distinguishes zero from removal, and the 1800 amount and date
   node/value/focus are preserved.
7. Save again: writes use expected versions `[1, 3]`; the second write succeeds
   as 1800/version 4, without an unnecessary second conflict. Another account's
   private budget remains unchanged.

Chinese and English tests also cover reload failure, disabled controls and the
language switch after successful review. Existing unknown-save-result retry and
late save/read tests remain green.

Browser verification used an isolated local database schema and synthetic
accounts: a real conflict followed by reload retained 1800 while displaying the
other session's 1200. Desktop and 390×844 viewport checks covered feedback and
language switching. These are browser checks, not physical-phone soft-keyboard
or production deployment validation. Synthetic data did not touch user ledgers.
