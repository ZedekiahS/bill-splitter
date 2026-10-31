# Interface decisions

The current design serves friends, roommates, and trip participants sharing
expenses. The user approved the first-priority shared-ledger features and allowed
a new palette suited to the task. See [PRODUCT.md](PRODUCT.md) for product scope.

Review builds must show the intended customer interface. Keep development,
demo-state, test, migration, and review commentary in project documents or the
conversation. On-screen copy should help the user complete the current task or
make a meaningful decision; do not add explanatory notices just for the reviewer.

## Visual language

A warm, quiet canvas supports a readable account book. Forest green identifies
primary actions and positive receivables; dark ink carries the content. Lists,
dividers, restrained panels, and aligned amounts provide hierarchy without charts
or decorative imagery. Typography uses local system fonts, including Chinese
fallbacks; monetary figures use tabular numerals.

| CSS token | Value | Purpose |
| --- | --- | --- |
| `--app-background` | `#f8f8f4` | Page canvas |
| `--surface` | `#ffffff` | Content and dialog surfaces |
| `--surface-subtle` | `#f1f3ee` | Quiet grouped content |
| `--sidebar-background` | `#f0f2eb` | Desktop navigation |
| `--ink` | `#202b27` | Main text |
| `--muted` | `#647069` | Supporting text |
| `--primary` | `#24594d` | Main action and selected emphasis |
| `--border` | `#e1e6de` | Content separation |
| `--danger` | `#a33f34` | Destructive corrections and errors |

Tokens live in `public/styles/app.css`. Page background and content surfaces are
separate so future background customization can preserve text contrast. No
background picker, upload, theme setting, or dark mode is implemented yet.

## Layout and interaction

The current ledger scopes four views: **总览**, **账单**, **结算**, **成员**.
Desktop uses a compact left sidebar and an overview with a primary content column
plus member/statement context. At narrower widths the content stacks; mobile
uses a single column, a ledger selector, and four-item bottom navigation. Lists
retain the amount, payer, participant context, and payment state at small sizes.

Expense entry follows amount, purpose/date, payer, participants, and an immediate
split preview. Percentage rows show their calculated money beside the input;
exact-amount rows show the assigned total and any difference. Switching modes
preserves each draft. Exact-amount shares must add up to the bill total before
saving. Native dialogs keep short tasks in context. Persistent labels,
visible keyboard focus, a skip link, named icon buttons, reduced-motion support,
and inline form errors form the accessibility baseline. Receipt confirmation and
reversal use explicit language; color is not the only status indicator.

The local demo has no real account writes; preview details belong in the review
conversation and documentation, not extra interface notices. Cloud members have
distinct temporary, pending claim, and bound-account states. The account menu
keeps original independent bills available without implying a migration.

The shared-ledger and sign-in screens offer Chinese and English from a compact
language selector. The choice persists on this browser. Translate interface copy,
validation, and exported statement labels; preserve entered names, titles, notes,
currencies, amounts, and dates. The favicon uses the same forest-green b. mark as
the product, including the legacy pages.

## Financial presentation

Store and calculate amounts in safe integer cents; parse at most two decimal
places. Show a currency for every ledger and keep CNY/USD totals separate. Equal
splits allocate every cent; percentage rounding preserves the assigned total and
leaves unassigned cost with the payer. Each expense allows up to eight selected
participants, including the payer when appropriate.

Outstanding receipts/payments describe individual expense obligations. Member
net balances offset both directions within the same ledger; they are a different
view of those records. A confirmed receipt is a recorded event, not a transfer by
the app. Reversals remain in the journal, and settlement text says it is not a
payment receipt.

New ledger dates use validated `YYYY-MM-DD` calendar strings. Original bills keep
UTC date handling. Date-only labels must not shift when the viewer's timezone
changes.

## Expense corrections and receipts

Reuse the expense editor for payer/owner corrections, with a required short reason.
Show repayment locks at the relevant fields. Keep unsaved input during remote
updates and show an actionable conflict error at save. History lives in the expense
list and detail dialog; before/after sections expand on demand, side by side on
desktop and stacked on mobile. Remote updates retain expanded history sections.

Attachments accept the native picker, drag/drop and screenshot paste. Thumbnails
open a keyboard-dismissable zoom/fit dialog without discarding editor input.
Downloads retain filenames. Removing a current attachment preserves its historical
version, explained once beside the editing controls.
