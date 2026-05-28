---
name: Architecture Baseline
description: Documented layer rules from docs/ARCHITECTURE.md — Router/Service/Repository/DB, SSoT, DTO separation, auth flow, transaction ownership
type: project
---

Source: docs/ARCHITECTURE.md (authoritative)

**Layer stack (top to bottom):**
Router → Service → Repository → DB

**Key rules:**
1. Router handles HTTP only: input parsing, response serialization, Service delegation. No domain logic.
2. Service owns business logic and domain rules. No direct Router dependency.
3. Transactions start and commit in Service, never in Router or Repository.
4. Authorization checks belong in Service, not Router.
5. Single Source of Truth: `Rental.returned_at IS NULL` is the canonical "active" signal. `Asset.status` is for maintenance states only — not "in use."
6. DTO/Schema (Pydantic) used for all API I/O. SQLAlchemy models are not returned directly.
7. No Repository layer currently exists — Service calls SQLAlchemy Session directly (pragmatic shortcut acknowledged).

**Frontend:**
- `frontend/src/api/client.ts` is the single API gateway for all pages.
- Pages (components) must use only exported functions from client.ts; raw fetch is forbidden in pages.

**Why:** Established at project inception; enforced by file-level comments in routers ("HTTP 입출력만; 비즈니스 로직은 services로 위임").
