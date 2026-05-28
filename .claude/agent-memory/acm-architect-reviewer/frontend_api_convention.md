---
name: Frontend API Layer Convention
description: client.ts is the single API gateway; pages must not use raw fetch — established convention in this codebase
type: project
---

**Convention:** All HTTP calls from React pages must go through exported functions in `frontend/src/api/client.ts`. Pages (AssetList.tsx, MyRentals.tsx, ReturnExtend.tsx) import from `../api/client` — never call `fetch()` directly.

**Evidence:** AssetList.tsx and MyRentals.tsx both import from client.ts and use no raw fetch. ReturnExtend.tsx violates this by declaring `const BASE = 'http://localhost:8000'` at line 5 and calling raw fetch at lines 19, 32, 41.

**Why this matters architecturally:** Breaking the single-gateway pattern means:
- Auth header injection (authHeaders()) is duplicated/skipped
- Error handling is inconsistent
- The transport layer is no longer a single seam for future changes (e.g., switching from fetch to axios, adding interceptors)
