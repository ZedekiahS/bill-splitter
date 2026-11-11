# Personal entry: cancellation and delayed results

## Problem and fix

The creation flow awaited the server response and ledger load without checking
whether the user still wanted to continue. Closing the creation form or navigating
away could therefore reopen the expense editor and, in some cases, restore the
previous destination.

The flow now shares the existing editor request generation. User close, Escape,
navigation, ledger selection, page exit and replacement dialogs invalidate it.
Creation and loading check it before changing the view, selected ledger, URL or
opening an editor. An obsolete creation failure also cannot write its error into
a newer dialog. Programmatic close after a successful create preserves the
continuation; its queued native close event does not cancel a valid first entry.

Cancellation does not undo a server write. Re-entering personal entry fetches the
ledger directory and reuses a personal ledger that was created while its response
was delayed. The same cancellation check covers loading an existing personal
ledger. No product copy or layout changed.

## Verification

- Reproduced three failing cases before the fix: delayed creation response with
  cancellation/navigation, delayed ledger load with navigation, and hash navigation.
- Added 12 regression cases to the actual app DOM harness. These hold responses at
  creation, ledger loading or draft loading and dispatch UI/navigation events.
- Covered cancel button, header close, Escape, pagehide, button/hash navigation,
  switching ledgers, opening/closing a replacement dialog, preservation of its
  typed name, and delayed draft reads. Already-created ledgers remain stored;
  re-entry does not create duplicates or save an expense automatically.
- A deliberately late programmatic close event still allows normal creation to
  open the editor and save the first expense.
- Existing Chinese/English creation, solo/shared entry, draft recovery,
  save-and-add-another and failed-refresh tests remain green.
- `node --test tests/personal-entry.test.mjs`: **22 passed**.
- `npm test`: **337 passed**, zero failures.
- `git diff --check`: passed.

This round uses JSDOM with the application's real handlers, IndexedDB draft store
and in-memory ledger domain. It does not claim new real-device/browser or
PostgreSQL/API testing. No backend/schema or financial-calculation changes were
needed, and no user ledger data was modified.
