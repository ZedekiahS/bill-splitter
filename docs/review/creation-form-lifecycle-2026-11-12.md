# Creation forms after navigation and cached return

## Confirmed regression

The previous cancellation change (`824a0b2`) invalidated the creation continuation
but left the creation dialog open after hash navigation or a cached page return.
Its submit handler checked validity only after sending the write. The result was
silently ignored, and subsequent clicks could create more empty ledgers.

Eight regression cases reproduced the issue before this fix: personal/shared
creation, hash navigation/cached return, and before/after initial submission.
Repeated submission produced two writes when none were expected, or three writes
when only the first was intended. Adding only the pre-write guard prevented extra
writes but still left all eight tests failing because the obsolete window stayed
open. This confirmed both parts of the lifecycle gap.

## Change

- Navigation buttons, hash navigation and pagehide now end an open creation dialog
  as they invalidate the continuation. Normal successful programmatic close still
  preserves the first-entry continuation.
- The creation handler checks operation validity, form attachment and dialog state
  before calling the store. Even a queued submit on an abandoned form cannot write.
- Already-completed creation is not undone. Personal re-entry still reads and
  reuses the created ledger; shared ledgers remain available for explicit selection.
- Expense draft recovery keeps its existing behavior. No product hints, additional
  confirmations, backend/schema or financial changes were added.

## Verification

- Eight previously failing cases now pass; each checks that the old form closes,
  obsolete submissions cannot write, and subsequent valid entry works.
- Two additional cases use the real auto-sync scheduler with controlled timers,
  the front end in API mode and the domain-store adapter. After a delayed creation,
  navigation and four completed sync rounds, the original shared ledger remains
  selected, the list contains the new ledger, and old-form submission cannot create
  another. Both personal and shared creation are covered.
- Clicking the current navigation tab also closes the old form even when the hash
  does not change.
- Existing Chinese/English creation, solo/shared expenses, draft recovery, delayed
  loading, replacement dialogs and queued programmatic close checks remain green.
- `npm test`: **348 passed**, zero failures; personal-entry suite: **33 passed**.
- `git diff --check`: passed.

These are automated DOM tests using actual app handlers, the IndexedDB draft store
and in-memory ledger domain. Cached return is simulated with persisted
pagehide/pageshow events; it is not a real-browser back/forward-cache test.
Auto-sync checks do not use the real API client or PostgreSQL. No new physical
device or deployment verification is claimed, and user ledger data was untouched.
