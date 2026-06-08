# Running account balances — design spike (WHO-68)

## Question

Should whome track **running balances** per account (checking, cash, credit card) in addition to categorized expenses?

## HomeHub / whome today

- `expenses` rows are **category + amount + date** — no account dimension.
- Shopping clear can auto-create a **Groceries** expense; no ledger link.
- Budgets (WHO-67) compare **monthly category spend vs target** — sufficient for envelope-style household budgeting.

## Options

| Approach | Pros | Cons |
|----------|------|------|
| **A — Defer** | Zero schema/UI cost; budgets cover 80% of dogfood need | No “how much is left in checking” view |
| **B — Opening balance + sum(expenses)** | Simple mental model | Credit cards, transfers, and income need separate rules; easy to lie |
| **C — Full ledger** (`accounts`, `transactions`, transfer pairs) | Correct double-entry semantics | Large surface: import mapping, reconciliation UI, admin |

## Recommendation

**Defer full balances (Option A)** until dogfood shows a concrete gap budgets cannot fill.

If revived later:

1. Add `expense_accounts` (name, type, optional opening balance).
2. Optional `account_id` on `expenses` (nullable for legacy rows).
3. Balance = `opening_balance - sum(expenses on account)` for asset accounts; invert sign for credit.
4. Do **not** mix with category budgets in v1 — show account strip separate from budget progress.

## Out of scope for spike

- Plaid/bank sync
- Split transactions
- Multi-currency

## Decision

**No build in this milestone.** Revisit when household asks for account-level reconciliation or import exposes HomeHub account fields worth mapping.
