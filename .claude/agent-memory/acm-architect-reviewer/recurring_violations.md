---
name: Recurring Conformance Violations
description: Layer violations and anti-patterns repeatedly observed across feat/return-extend and feat/review-tuni PRs
type: project
---

**Violation 1 — Router bypass of Service layer (CRITICAL)**
Both PRs implement return_rental and extend_rental directly in the Router (db.get, db.commit) rather than delegating to rental_service. This is the single most frequent violation in this codebase. Any new PATCH/POST endpoint in routers/rentals.py should be scrutinized for Service bypass.

**Violation 2 — Authorization check misplaced in Router (CRITICAL)**
`extend_rental` in routers/rentals.py checks `rental.user_id != user_id` directly in the router. ARCHITECTURE.md §4 explicitly assigns authorization to the Service layer.

**Violation 3 — Transaction ownership in Router (CRITICAL)**
`db.commit()` called in Router handlers (return_rental, extend_rental). ARCHITECTURE.md §5 assigns transaction start/commit to the Service.

**Violation 4 — Dual state update (SSoT violation, MAJOR)**
return_rental sets both `Rental.returned_at` and `Asset.status = "available"`. ARCHITECTURE.md §2 designates `Rental.returned_at` as the single source of truth; `Asset.status` is for maintenance, not in-use tracking.

**Violation 5 — Frontend page bypassing client.ts (MAJOR)**
ReturnExtend.tsx declares its own `const BASE` and calls raw `fetch()` instead of using exported functions from api/client.ts.

**Violation 6 — Display/presentation logic in API client (MAJOR)**
fetchAssets() in client.ts applies `.filter(status !== 'retired')` and `.sort(localeCompare)` — presentation concerns placed in the transport/API layer.

**How to apply:** Flag any of these patterns immediately as CRITICAL or MAJOR. These are not one-off mistakes; they reflect a systemic tendency to shortcut the layered architecture.
