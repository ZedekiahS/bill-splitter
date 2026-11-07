# Entry flow review — 2026-11-06

## Delivered behavior

Continuous inline participant creation keeps the input open and focused, supports Enter and lists matching existing names. Custom amount inputs are preserved. Search appears for groups larger than four; selection count and clear/all controls are inline. More than eight ledger members no longer means arbitrarily selecting the first eight. The per-expense cap remains eight.

Percentage inputs start equal, calculate in hundredths of a percent, and distribute the remainder among unedited selected people. With two people, changing either input complements the other. With three or more, explicit inputs remain fixed; the last untouched input completes the remainder. If every input is explicitly edited, all are kept and the existing total validation applies. The edited set is saved in the local draft. Over-100 or incomplete input does not generate negative shares.

Preview member rows use final consumption, including any payer remainder in older explicit percentage drafts. Ordinary drafts, source templates and consecutive entries use separate keys. Correction recovery compares the old baseline, raw draft and latest expense. Independent changes merge, overlapping fields are presented for selection, and payments prevent financial overwrite. Receipt choices may retain a receipt from this expense's immutable history; references from other expenses remain rejected.

Saving preserves the current view, filter, search and scroll position. Save-and-add-another starts a distinct draft with selected people retained and title/amount/notes/receipts cleared. Device-local dates apply to new expenses and repayments; recurring periods retain Shanghai scheduling.

Temporary-member rename/removal requires the owner or original adding member. Claimed accounts are protected. Removal checks current and reversed expenses, historical versions, templates, payments and all invitations. Renames retain identity and name-change metadata; this is not a full membership audit UI or used-member deactivation.

## Verification

- Existing unit suites plus regression cases for separate draft identities, three-way correction recovery, overlapping content, payment locks, incomplete raw amounts, receipts, percentage completion and member permissions.
- PostgreSQL/API regression runs use the isolated `entry_regression_20261106` schema, with no public-schema fallback. Browser fixtures use a separate `flow_ui_20261106` schema on port 2808. The phone user's database records were not reset.
- Real browser member and owner sessions on separate localhost origins: 60/40; initial 33.34/33.33/33.33; 60/30/10; Enter adds successive members; matching names reuse existing identities; save-and-continue clears fields and retains people; ten-member ledger selects only self.
- A normal unfinished dinner remains intact when using a rent template. One account edits the title while the other saves a note; stale submission is rejected, comparison preserves both edits, and saving returns to the original search/filter. Temporary-member rename succeeds on mobile.
- Desktop and 390×844 browser viewport inspected. This validates responsive layout, not an actual iOS/Android keyboard session; the user's phone can review through the existing LAN address.

Screenshots are stored outside the repository in the current Codex visualization directory: `draft-conflict-review.png` and `percentage-auto-mobile.png`.

Final checks: 193 unit/local tests and 44 PostgreSQL/API tests passed (237 total). `git diff --check` and syntax checks passed. Impeccable's detector returned no rule findings but reported an existing `COMP_ROUND_OPEN` workflow marker; no unrelated design-workflow metadata was changed.

The isolated browser test server was stopped. Automatic approval rejected the combined command to restart the existing phone server without giving a specific reason. That server remains on port 2807; the updated phone preview runs on port 2809 against the same saved-ledger database. The existing 800 CNY hotpot and 80 CNY lunch were verified present. Browser drafts are origin-local, so drafts on port 2807 remain there and are not automatically moved to 2809. `LAN_PORT` now accepts an optional validated port; its default remains 2807.
