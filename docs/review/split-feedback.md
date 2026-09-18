# Split-form feedback — 2026-09-18

Implemented the two browser comments: an exact-amount mode for known individual
costs, and a calculated currency amount on every percentage row.

Exact amounts accept explicit zero and up to two decimal places. Every selected
member needs an amount, and their sum must match the bill total. The form reports
the assigned amount, missing inputs, and any shortfall or excess. It never
silently moves an exact-amount difference to the payer. Percentage behavior is
unchanged: any unallocated percentage remains payer consumption.

On the first switch to exact amounts, the current valid split is copied into the
fields. Later switches preserve the separate drafts. Inactive and unselected
inputs are disabled so their retained draft cannot block another mode's save.

Validation:

- 36 shared-ledger core/store tests passed, including 10 additional cases for
  exact amounts, zero, limits, invalid values, totals, and persisted balances.
- Browser: 600 at 20/30/50 percent shows 120/180/300 beside the inputs. Changing
  the total to 1200 updates the outputs to 240/360/600.
- Browser: a 550 allocation against 600 reports a 50 shortfall and rejects save.
  A 100/200/300 allocation saves and shows 500 receivable for the payer.
- Browser: switching back and forth preserves both the entered percentages and
  exact amounts.
- Desktop and 390-pixel mobile views were inspected; the form has no horizontal
  overflow. Screenshots: `percent-inline-desktop.jpg`,
  `percent-inline-mobile.jpg`, and `amount-split-mobile.jpg`.

Checks used the isolated local demo on port 2803. No production data or rules
were changed. The public preview remains on port 2801.
