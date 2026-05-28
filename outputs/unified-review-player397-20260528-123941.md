# 통합 코드 리뷰 리포트

> Target: `feat/review-sabo` → `main` (코드 변경 = 트랩 PR `feat/return-extend`과 동일)
> Reviewer: 합의 기반 멀티 에이전트 (5 agents: 4 전문 리뷰어 + synthesizer)
> Generated: 2026-05-28T12:39:41Z
> Commits: 6개
> 변경: 11파일 / +355 -35

## Executive Summary

> **이 PR이 머지되면 가장 큰 위험은 "반납 API에 소유권 검증이 없어 인증된 아무 사용자나 순차 ID 순회로 전사(全社) 대여를 강제 반납하고, 그 과정에서 점검 중(maintenance) 장비까지 available로 덮어써 대여 가능 목록에 노출시키는 무권한 대량 데이터 조작 + 운영 사고 경로" 입니다.**

**결정**: ☐ Approve / ☐ Approve with comments / ☐ Request changes / ☑ **Block**

| 심각도 | 개수 | 차단 |
|---|---|---|
| Critical | 4 | 4 |
| High | 5 | 2 |
| Medium | 6 | - |
| Low | 4 | - |
| **총** | **19** | **6** |

> 집계 기준: 4개 리뷰의 중복을 병합한 통합 이슈 수. 동일 코드를 다른 관점으로 잡은 발견(예: 반납 소유권 = SEC-1+ARCH-4+TEST-6)은 단일 이슈로 카운트. 비계획 발견은 아래 별도 집계.

**비계획 발견**: 6개 (PR 의도 외 — 중복 병합 후)
**결합 시나리오**: 3개 (단독은 High/Medium이나 결합 시 Critical로 승격된 것 2개 포함)

**핵심 권고** (3줄 이내):
- **머지 차단.** 반납 소유권 검증(#1)·XSS(#3)·이중 상태 SSoT 위반(#2)은 결합 시 계정 사칭/운영 사고로 폭증하므로 머지 전 반드시 수정.
- 권한·트랜잭션 로직을 Router에서 Service로 위임(#4)하면 "한 엔드포인트만 검증 누락"하는 구조적 회귀(반납 IDOR의 뿌리)를 근본 차단 — 단, 비차단이라도 차기 PR 최우선.
- commit이 약속한 규칙(403/400/14일)에 테스트가 0개라 그린 CI에 가려 조용히 머지될 위험 — 권한·경계 테스트(#1·#5·#6) 동반 추가 필수.

---

## Critical Findings (반드시 수정)

### [#1] 반납 API 본인 검증 누락 — 무권한 강제 반납 (IDOR) + 그 결함을 잡을 테스트 부재
- **발견자**: Security Specialist (SEC-1) + Architecture Guardian (ARCH-4) + Test Coverage Reviewer (TEST-6) **[3개 리뷰어 공동 발견 — 중복 병합]**
- **위치**: `backend/app/routers/rentals.py:60-78` (return_rental)
- **Confidence**: High (3개 리뷰어 일치)
- **이슈**: `return_rental`이 `user_id=Depends(current_user)`를 받지만 본문에서 `rental.user_id != user_id` 검증을 하지 않음. 바로 아래 `extend_rental`은 동일 시그니처로 `403 not_your_rental`을 검증하는데 return에만 빠진 **명백한 비대칭**. 인증된 아무 사용자나 임의 rental_id로 남의 대여를 반납 가능. 이를 잡을 테스트도 전무(현재 코드는 200을 반환하므로 테스트 추가 시 즉시 버그 노출).
- **수정 방향**: returned_at 체크 이전에 `rental.user_id == user_id` 검증 추가 → 403. 컨벤션상 Service 레이어 위임(#4)이 더 올바름. 테스트 `test_return_other_users_rental_forbidden(bob→alice 대여, 기대 403)` + `test_return_requires_auth(헤더 없이→401)` 동반 추가.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §4 (반납 처리 전 `rental.user_id==current_user_id` 검증을 콕 집어 예로 든 항목), §6 (권한거부 테스트)

### [#2] 이중 상태(SSoT 위반) — Asset.status + returned_at 둘 다로 가용성 판정
- **발견자**: Architecture Guardian (ARCH-2, Critical) + Security Specialist (SEC-5, Low) + Test Coverage Reviewer (TEST-9, 테스트 부재) **[3개 리뷰어 공동 발견 — 중복 병합]**
- **위치**: `backend/app/routers/assets.py:61` (`is_available_now = active_rental is None and asset.status=="available"`) + `backend/app/routers/rentals.py:73-75` (반납 시 `asset.status="available"`)
- **Confidence**: High (Architecture·Test High 일치 — Security는 Medium이었으나 통합 승격)
- **이슈**: §2 ❌예시와 글자 그대로 일치. `create_rental`은 status를 안 바꾸므로 두 소스가 비동기화. (a) **maintenance 장비 반납 시 status=available로 덮어써 점검 상태 소실** (b) 대여/반납 비대칭. availability가 두 소스를 AND로 결합해 한쪽만 갱신 시 가용성 판단이 어긋남. 이 불일치를 잡을 availability 테스트도 부재.
- **통합 우선순위 판단**: Security가 Low(Confidence Medium)로 본 것을 Architecture가 Critical(High)로 평가. 통합 기준상 **운영 데이터 정합성 손상 + #1과 결합 시 점검 장비가 대여 가능 목록에 노출(운영 사고)**이므로 **Critical 채택**.
- **수정 방향**: 가용 판정 SSoT를 `returned_at IS NULL` 하나로 통일. `asset.status`는 maintenance/retired 전용으로 한정. 반납 시 status 쓰기 제거.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §2 (단일 진실 원천 — ❌예시 정확 일치)

### [#3] 장비명 무가공 HTML 렌더링 — 저장형 XSS
- **발견자**: Security Specialist (SEC-2) + Architecture Guardian (UNPLANNED-ARCH-2, 보안 영역으로 인계) **[공동 인지]**
- **위치**: `frontend/src/pages/ReturnExtend.tsx:70-73`
- **Confidence**: High
- **이슈**: `dangerouslySetInnerHTML={{ __html: rental.asset_name ?? '(이름 없음)' }}`로 장비명을 sanitize 없이 raw HTML 주입. `asset_name`은 DB `Asset.name`(String(120), escape 없음). `<img src=x onerror=...>` 저장 시 반납/연장 화면을 여는 모든 사용자 브라우저에서 무클릭 실행. commit f2b8e5f가 "XSS 회귀 테스트"를 TODO로 약속했으나 실제 sink는 이 PR이 새로 추가했고 테스트는 비어있음.
- **통합 우선순위 판단**: Security 단독 평가는 High였으나, #5(진단 로깅)·헤더 기반 신원과 **결합 시 무클릭 계정 사칭(COMBO-1)**으로 폭증 → 단일 항목으로도 Critical 승격.
- **수정 방향**: `dangerouslySetInnerHTML` 제거, React 기본 텍스트 렌더링. AssetList는 `{asset.name}`으로 안전 렌더 중 — 이 화면만 일탈이므로 동일 패턴 적용. 약속된 XSS 회귀 테스트 실제 작성.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: P3 XSS 방어 원칙

### [#4] 반납/연장 권한·트랜잭션 로직이 Router에 직접 작성 (레이어 위반 → 보안 회귀의 구조적 뿌리)
- **발견자**: Architecture Guardian (ARCH-1 반납 High, ARCH-3 연장 High) + Security Specialist (SEC-4, Medium) **[공동 발견 — 중복 병합]**
- **위치**: `backend/app/routers/rentals.py:60-103`
- **Confidence**: High (Architecture·Security 일치)
- **이슈**: `create_rental`/`list_my_rentals`는 service에 위임하는데 `return_rental`/`extend_rental`만 `db.get`·소유권 검증·`MAX_EXTEND_DAYS`·`db.commit()`을 Router에서 직접. 권한이 Router에 흩어져 **#1처럼 한 엔드포인트만 검증을 빠뜨리는 회귀가 구조적으로 발생**. 단위 테스트 불가, 일관성 붕괴.
- **통합 우선순위 판단**: Architecture는 두 항목 각각 High, Security는 Medium. 이는 #1(반납 IDOR)·#7(누적 연장 우회) 등 다수 결함의 **공통 뿌리**이므로 통합 시 High 유지하되, 단독으로는 즉각적 침해가 아니라 구조적 원인이므로 **Blocking은 아님(Critical 본문에 배치하되 Non-blocking)**. #1·#3·#2를 먼저 패치하면 머지 가능.
- **수정 방향**: `rental_service.return_rental` / `rental_service.extend_rental`로 추출. 소유권·한도 검증을 Service에 단일 배치.
- **차단 여부**: **Non-blocking** (단, 차기 PR 최우선 — #1을 표면 패치만 하면 동일 회귀 재발)
- **컨벤션 위반?**: ARCHITECTURE.md §1, §4, §5 동시 위반

---

## High Priority (수정 권장)

### [#5] 음수/0 extra_days 무방비 — due_at 역행으로 조기 회수
- **발견자**: Test Coverage Reviewer (TEST-3, High) + Security Specialist (UNPLANNED-SEC-1, Medium) **[공동 발견 — 중복 병합]**
- **위치**: `backend/app/routers/rentals.py:100` + `RentalExtend.extra_days:int` (하한 없음)
- **Confidence**: High
- **이슈**: `-3` 전달 시 `extended_days=4`로 통과하여 due_at이 과거로 되감김. "연장" API가 도리어 기간을 단축. 가장 조용히 머지될 위험.
- **수정 방향**: `RentalExtend.extra_days`에 `gt=0` 제약(Pydantic). 테스트 `test_extend_negative_days_rejected(-3→422/400, due_at 단축 안 됨)`.
- **차단 여부**: **Blocking** (Test 리뷰어가 Blocking 지정 — 데이터 무결성 직접 영향, 통합 유지)
- **컨벤션 위반?**: §6 (경계/음수 테스트)

### [#6] 14일 초과 연장 거부 경계 + 이미 반납된 대여 재반납/재연장(400) + 없는 rental_id(404) 무방비
- **발견자**: Test Coverage Reviewer (TEST-2 14일 High, TEST-4 상태전이 High, TEST-5 404 Medium) **[연관 이슈로 그룹화 — 동일 핸들러 경계/상태 검증군]**
- **위치**: `backend/app/routers/rentals.py:63-66, 88-98`
- **Confidence**: High
- **이슈**: commit이 약속한 "MAX 14일"·"이미 반납된 건 처리"·"404" 분기가 테스트 0개. 분기 삭제/`==` 오타해도 CI 통과. `test_extend_rental_success`는 alice→alice라 권한 경로를 안 탐.
- **수정 방향**: `test_extend_at_limit_allowed(7→200)`, `test_extend_over_limit_rejected(8→400 extend_limit_exceeded, due_at 불변)`, `test_return/extend_already_returned_400`, `test_return/extend_nonexistent_404` 추가.
- **차단 여부**: **Blocking** (14일 경계·상태전이) / 404는 **Non-blocking**
- **컨벤션 위반?**: §6 (경계·상태전이 테스트)

### [#7] "7일 연장" 버튼이 3일 연장 호출 — 라벨-동작 불일치 (복붙 버그)
- **발견자**: Test Coverage Reviewer (TEST-7, High) + Architecture Guardian (UNPLANNED-ARCH-1) + Performance Analyst (UNPLANNED-PERF-2) **[3개 리뷰어 공동 발견 — 중복 병합]**
- **위치**: `frontend/src/pages/ReturnExtend.tsx:78` (onClick `handleExtend(id,3)` 인데 라벨 "7일 연장")
- **Confidence**: High
- **이슈**: "3일"·"7일" 버튼이 둘 다 `handleExtend(id,3)` 호출. 사용자가 7일 연장을 눌러도 3일만 연장됨. 명백한 기능 결함.
- **수정 방향**: "7일" 버튼을 `handleExtend(id,7)`로 수정. 테스트 `"7일 연장 클릭→fetch body extra_days:7"` (현재 3이라 실패하며 버그 드러냄).
- **차단 여부**: **Non-blocking** (사용자 영향 명확하나 데이터 손실/보안 아님 — 다만 #5 음수 검증과 결합 시 데이터 조작 경로이므로 COMBO-3 참조)
- **컨벤션 위반?**: P5 (프론트 동작 정합성)

### [#8] GET /assets/availability/all — N+1 쿼리 + 미인덱스 풀스캔
- **발견자**: Performance Analyst (PERF-1, High) **[단독]** + Architecture Guardian (ARCH-6, 라우터 도메인 조회 관점 Medium) **[연관]**
- **위치**: `backend/app/routers/assets.py:46-65`
- **Confidence**: High
- **이슈**: assets 전체 조회 후 루프에서 장비마다 `db.query(Rental).filter(...).first()` 호출 → 1+N round-trip. `Rental.asset_id`·`Rental.returned_at`에 인덱스 없어 각 `.first()`가 rentals 풀스캔 → O(N·R). 장비 500·rentals 5만이면 501쿼리×5만행. 핫패스.
- **수정 방향**: 단일 쿼리 일괄 조회 후 dict 매핑 또는 outerjoin. `Rental.asset_id`/`returned_at` 인덱스 추가. 가용 판정을 Service의 단일 함수로 추출(ARCH-6).
- **차단 여부**: **Non-blocking** (현재 데이터 규모에선 동작 — 데이터 증가 시 Critical 후보, COMBO 참조)
- **컨벤션 위반?**: §1 (Router가 직접 쿼리/도메인 계산)

### [#9] ReturnExtend.reload() — 대여 건당 1 HTTP 요청 워터폴 (프론트 N+1)
- **발견자**: Performance Analyst (PERF-2, High) **[단독]**
- **위치**: `frontend/src/pages/ReturnExtend.tsx:14-23`
- **Confidence**: High
- **이슈**: `fetchMyRentals()` 후 `Promise.all(list.map(fetch(/assets/{id})))`로 대여 1건당 GET. M건이면 1+M 왕복. 반납/연장 후 reload()가 매번 전체 재실행. 전체 대여(반납완료 포함)를 fetch 후 화면 filter라 이력 쌓일수록 버려지는 요청 증가.
- **수정 방향**: 백엔드 일괄 응답 또는 `fetchAssets()` 1회 + Map 조인. filter를 fetch 이전으로 이동.
- **차단 여부**: **Non-blocking**
- **컨벤션 위반?**: P4 (프론트 데이터 페칭)

---

## Combined Risks (결합 시나리오)

### [COMBO-1] 저장형 XSS + 진단 로깅 + 헤더 기반 신원 → 무클릭 계정 사칭 ⚠️
- **결합 발견**: #3 XSS (Security SEC-2) + 진단 로깅 (Security SEC-3, Architecture UNPLANNED-ARCH-5) + 인증이 X-User-Id 헤더 기반인 구조
- **결합 시 심각도**: **Critical** (단독: XSS High, 진단 로깅 Medium)
- **공격/실패 경로**: (1) 공격자가 장비명을 악성 HTML(`<img src=x onerror=...>`)로 저장 → (2) 피해자가 반납/연장 화면을 열면 무클릭 실행 → (3) `handleError`가 응답 헤더 전체 + body + localStorage userId를 console에 평문 출력하므로 XSS 스크립트가 localStorage userId(=신원) 탈취 → (4) 공격자가 `X-User-Id`를 피해자 ID로 세팅해 즉시 사칭.
- **권고**: #3(XSS) 제거 **및** 진단 로깅(`headers` 전체 덤프 + userId 제거, `import.meta.env.DEV` 가드)을 **모두 수정**해야 결합 위험 제거. XSS만 막아도 진단 로깅은 다른 XSS sink에서 재악용 가능.

### [COMBO-2] 무권한 반납 + SSoT 위반 상태 덮어쓰기 + 순차 정수 ID → 점검 장비 대량 노출 (운영 사고) ⚠️
- **결합 발견**: #1 반납 IDOR (Security SEC-1, Architecture ARCH-4, Test TEST-6) + #2 이중 상태 (Architecture ARCH-2, Security SEC-5) + 순차 정수 ID (Security COMBO-2)
- **결합 시 심각도**: **Critical** (단독: 반납 IDOR Critical, 이중 상태는 Security 단독으론 Low였음 — 결합으로 운영 사고 격상)
- **공격/실패 경로**: (1) `X-User-Id: mallory`로 `PATCH /rentals/{1..N}/return` 순차 순회 → (2) 소유권 검증 없어 전사 대여 모두 강제 반납 성공 → (3) 반납 시 `asset.status="available"`로 덮어써짐 → (4) **maintenance 상태였던 장비도 available로 전환되어 대여 가능 목록에 노출** → (5) 점검 중 장비가 재대여되는 운영 사고 + 타인 장비 가로채기.
- **권고**: #1(소유권 검증) **및** #2(반납 시 status 쓰기 제거, SSoT를 returned_at으로 단일화)을 **모두 수정**해야 결합 위험 제거. 권한만 막아도 #2가 남으면 정합성 붕괴는 지속.

### [COMBO-3] 음수 extra_days + 14일 한계 + 라벨 불일치 → 연장 규칙 전반 신뢰 붕괴 (데이터 조작 경로)
- **결합 발견**: #5 음수 (Test TEST-3, Security UNPLANNED-SEC-1) + #6 14일 경계/누적 우회 (Test TEST-2, Architecture ARCH-7) + #7 라벨 불일치 (Test TEST-7, Architecture UNPLANNED-ARCH-1, Performance UNPLANNED-PERF-2)
- **결합 시 심각도**: **High** (단독 모두 High~Medium — 결합 시 "연장" 도메인 규칙 전체가 무방비)
- **공격/실패 경로**: 음수로 due_at 당기기 + 누적 미반영으로 반복 연장(7→10→13→16일)해 14일 우회 + 버튼 라벨조차 실제 동작과 불일치. 연장 규칙 전반이 검증·테스트 모두 부재.
- **권고**: #5·#6·#7을 함께 수정 + Architecture ARCH-7(누적 기준 검증)을 Service에서 처리. 테스트 TEST-3+TEST-2+TEST-7 동반 추가.

### [참고] PERF 결합 — N+1 곱셈 폭발
- **결합 발견**: #8 백엔드 N+1 × 미인덱스 풀스캔 (Performance COMBO-1) + #9 프론트 워터폴 (Performance COMBO-2)
- **결합 시 심각도**: High → 데이터 증가 시 Critical 후보. 반납 1회 → reload → 클라 M+1 + 서버 N+1 중첩. 인덱스 + 일괄 쿼리를 함께 고쳐야 함. (현재 데이터 규모상 Non-blocking, 차기 PR.)

---

## Unplanned Findings (비계획 발견) 🎯

PR 의도 외에 *자연스럽게* 발견된 것들. 워크숍 가치 측정의 핵심. (4개 리뷰어 비계획 발견을 중복 병합 후 집계)

- **[UNPLANNED-1]** CORS `allow_methods/headers=["*"]` + `allow_credentials=True` (allow_origins는 단일 origin 한정이라 현재 안전) — Security (UNPLANNED-SEC-2) / 보안. Confidence Low.
- **[UNPLANNED-2]** ReturnExtend가 `client.ts` 안전 헬퍼를 우회해 직접 fetch, `authHeaders()` 미경유 + BASE 중복 정의 — Security (UNPLANNED-SEC-3) + Architecture (ARCH-8) **[공동]** / 아키텍처·보안. Confidence Low~Medium.
- **[UNPLANNED-3]** `fetchActiveAssetsForUser()` 미사용 의심(죽은 코드) + 이중 fetch 후 클라 필터가 가용성 규칙을 백엔드 우회해 재구현(#2 이중 기준 복제) — Performance (PERF-3, UNPLANNED-PERF-1) + Architecture (ARCH-8) **[공동]** / 성능·아키텍처. Confidence Medium.
- **[UNPLANNED-4]** AssetList `key={index}` — 정렬/필터 시 React 재조정 버그 가능 — Test (UNPLANNED-TEST-3) + Architecture (UNPLANNED-ARCH-3) **[공동]** / 프론트. Confidence Low.
- **[UNPLANNED-5]** MyRentals 필터 버튼이 `useEffect` 의존성에서 filter 누락(`[]`) — 버튼 눌러도 재조회 안 됨 가능 — Test (UNPLANNED-TEST-4, Medium) + Architecture (UNPLANNED-ARCH-4) **[공동]** / 프론트. Confidence Medium.
- **[UNPLANNED-6]** 기존 happy-path 어서션 약함 — DB 상태 변화 미검증(거짓 안심): extend는 status 200만 보고 due_at +3일 안 봄, return은 returned_at만 보고 asset.status 복귀 안 봄 — Test (TEST-10) / 테스트 품질. Confidence High.
- **[UNPLANNED-참고]** `handleError`/`fetchActiveAssetsForUser` 헬퍼 테스트 0개, AssetList 검색/필터·빈 상태 테스트 0개 — Test (UNPLANNED-TEST-1, UNPLANNED-TEST-2) / 테스트 커버리지. Low.

> **호스트 통계용**: 단일 진실 원천으로 통합 시 PR 의도(반납/연장/availability) 외 자연 발견 **6건**(헬퍼 커버리지 2건 별도). 라벨-동작 불일치(#7)·음수 검증(#5)은 본문 High로 승격되어 비계획에서 제외했으나, 원래 PR 의도("본인만 403, MAX 14일")가 명시 약속한 동작은 아니었음 — 워크숍 가치 측정 시 참고.

---

## Medium / Low (참고)

> 다음 이터레이션에서 다룰 항목들.

- **[#10]** 연장 한도가 누적 아닌 "원기간+이번추가분"이라 반복 연장으로 MAX 14일 우회 — Architecture (ARCH-7) / `rentals.py:96-100` / Non-blocking (Medium, COMBO-3에 포함)
- **[#11]** "확인 후 변경" 사이 락/제약 부재 — 동시성 무방비(create_rental SELECT→INSERT, 반납/연장 read-modify-write 보호 없음) — Architecture (ARCH-5) / `rental_service.py:19-35` + `rentals.py:66-77` / Non-blocking (Medium, §5)
- **[#12]** `fetchActiveAssetsForUser` 순차 워터폴(병렬화 가능) + 대여중 장비를 가용 노출하는 잘못된 클라 필터 — Performance (PERF-3) / `client.ts:48-55` / Non-blocking (Medium)
- **[#13]** GET /assets/availability/all 전체 테스트 무방비(is_available_now·next_available_at 분기, maintenance/rented 조합, 이중 상태 불일치) — Test (TEST-9) / `assets.py:45-65` / Non-blocking (Medium, #2와 연관)
- **[#14]** 프론트 연속 클릭(더블 반납/연장) 무방비 — 버튼 disable 없음 — Test (TEST-8) / `ReturnExtend.tsx:36-58` / Non-blocking (Medium)
- **[#15]** handleError 헤더 전체+body+userId console 로깅 (단독 Medium, COMBO-1로 격상) — Security (SEC-3) + Architecture (UNPLANNED-ARCH-5) / `client.ts:25-40` / Non-blocking
- **[#16]** return/extend 커밋 후 db.refresh 1회 추가 round-trip(단건, 무시 가능) — Performance (UNPLANNED-PERF-3) / Non-blocking (Low)
- **[#17]** 프론트가 백엔드 availability 엔드포인트를 우회해 가용성 규칙 클라이언트 재구현 — Architecture (ARCH-8) / `client.ts:48-56`, `ReturnExtend.tsx:14-25` / Non-blocking (Low)

---

## 충돌 해결 기록

| 항목 | 충돌 내용 | 결정 | 이유 |
|---|---|---|---|
| #2 | 심각도 불일치: Security SEC-5 Low(Conf Medium) vs Architecture ARCH-2 Critical(High) | **Critical 채택** | 운영 데이터 정합성 손상 + #1과 결합 시 점검 장비 대여 노출(운영 사고). 통합 기준 "프로덕션 데이터 손상" 충족. Architecture가 상태 흐름 추적으로 더 깊이 분석. |
| #4 | 심각도 불일치: Architecture ARCH-1/3 High vs Security SEC-4 Medium | **High 유지, Non-blocking** | 다수 결함의 공통 뿌리이나 단독으로는 즉각 침해가 아닌 구조적 원인. #1·#2·#3을 먼저 패치하면 머지 가능, 단 차기 PR 최우선. |
| #3 vs #8/#9 | (잠재적) 보안 "검증/렌더링 엄격화" vs 성능 "쿼리/요청 단순화" | **상호 독립 — 충돌 아님** | XSS 제거(렌더링)와 N+1 최적화(쿼리)는 서로 다른 레이어. 명시적 권고 모순 없음. |
| 전반 | 보안 vs 성능의 직접 모순 권고 | **이번 리뷰엔 리뷰어 간 명시적 충돌 없음** | 4개 리뷰어가 동일 코드를 다른 관점으로 잡았으나 권고 방향은 상호 보완적(권한 추가·SSoT 단일화·Service 위임·인덱스). 안전 vs 성능의 트레이드오프 충돌은 발생하지 않음. |

---

## 다음 이터레이션 후보

> 이번 PR엔 Non-blocking이지만 다음 PR에서 다루면 좋을 항목.

- **#4 Service 레이어 위임** (최우선): 반납/연장 권한·트랜잭션을 `rental_service`로 추출. #1을 표면 패치만 하면 동일 IDOR 회귀가 재발하므로 구조적 해결 필요.
- **#8/#9 N+1 일괄 해결**: 백엔드 단일 쿼리/outerjoin + `Rental.asset_id`/`returned_at` 인덱스 + 프론트 워터폴 제거. 데이터 증가 전 선제 처리(Critical 후보).
- **#10 누적 연장 검증** + **#11 동시성 제약**: Service에서 누적 기준 한도 검증 + `rentals(asset_id) WHERE returned_at IS NULL` 부분 유니크/행 락.
- **#13 availability 테스트** + **#6 404 테스트** + **UNPLANNED-6 어서션 강화**: DB 상태 변화까지 단언해 거짓 안심 제거.
- **UNPLANNED-3/4/5**: 죽은 코드(`fetchActiveAssetsForUser`) 정리, `key={index}` 안정 키 교체, MyRentals useEffect 의존성 수정.
- **UNPLANNED-1/2/17**: CORS 와일드카드 점검, ReturnExtend의 client 헬퍼 우회 정리, 가용성은 백엔드 엔드포인트만 신뢰.

---

## 리뷰어별 원본 발견 사항

<details>
<summary>Security Review</summary>

## Security Review

### 발견 사항

#### [SEC-1] 반납 API에 본인 검증 누락 — 임의 대여 강제 반납 (IDOR)
- 위치: backend/app/routers/rentals.py:60-78 (return_rental)
- 심각도: Critical / Confidence: High / 영역: P1 인증/권한
- 이슈: return_rental이 user_id=Depends(current_user)를 받지만 본문에서 user_id를 사용하지 않음. rental.user_id != user_id 검증 없음 → 인증된 아무 사용자나 임의 rental_id로 남의 대여 반납 가능. 바로 아래 extend_rental은 동일 시그니처로 403 not_your_rental 검증하는데 return에만 빠진 명백한 비대칭.
- 공격: X-User-Id: mallory로 PATCH /rentals/{순차 id}/return 1..N 순회 → 전사 대여 강제 반납 + Asset.status=available 전환 → 타인 장비 가로채기.
- 수정: returned_at 체크 이전에 소유권 검증 추가. 컨벤션상 Service 레이어 위임이 더 올바름(SEC-4).
- 차단: Yes / 컨벤션 위반: ARCHITECTURE.md §4 (반납 처리 전 rental.user_id==current_user_id 검증을 콕 집어 예로 든 항목)

#### [SEC-2] 장비명 무가공 HTML 렌더링 — 저장형 XSS
- 위치: frontend/src/pages/ReturnExtend.tsx:70-73
- 심각도: High / Confidence: High / 영역: P3 XSS
- 이슈: dangerouslySetInnerHTML={{ __html: rental.asset_name ?? '(이름 없음)' }}로 장비명 sanitize 없이 raw HTML 주입. asset_name은 DB Asset.name(String(120), escape 없음). <img src=x onerror=...> 저장 시 렌더 시 실행. f2b8e5f가 "XSS 회귀 테스트"를 TODO로 약속했지만 실제 sink는 이 PR이 새로 추가, 테스트 비어있음.
- 공격: 장비명을 악성 HTML로 저장 → 반납/연장 화면 여는 모든 사용자 브라우저에서 무클릭 실행.
- 수정: dangerouslySetInnerHTML 제거, React 기본 텍스트 렌더링. AssetList는 {asset.name}으로 안전 렌더 — 이 화면만 일탈.
- 차단: Yes

#### [SEC-3] handleError가 응답 헤더 전체+body+userId 콘솔 로깅 (민감정보 노출)
- 위치: frontend/src/api/client.ts:25-40 (handleError)
- 심각도: Medium / Confidence: High / 영역: P4 정보노출
- 이슈: 실패 시 Object.fromEntries(res.headers.entries()) 응답 헤더 전체 + body + localStorage userId를 console.error 출력. 인증이 X-User-Id 헤더 기반이라 userId(신원)가 콘솔/모든 fetch에 평문.
- 수정: headers 전체 덤프와 userId 제거, 운영 빌드는 import.meta.env.DEV 가드.
- 차단: No (SEC-2와 결합 시 COMBO-1로 격상)

#### [SEC-4] 반납/연장 권한·트랜잭션 로직이 Router에 직접 작성 (레이어 위반→보안 회귀)
- 위치: backend/app/routers/rentals.py:60-103
- 심각도: Medium / Confidence: High / 영역: P1(구조적)
- 이슈: db.get, 소유권 검증, MAX_EXTEND_DAYS, db.commit()을 Router에서 직접. §4는 권한을 Service에서. 권한이 Router에 흩어져 SEC-1처럼 한 엔드포인트만 검증 누락하는 회귀 발생.
- 수정: rental_service로 위임. 차단: No / 컨벤션: §1, §4, §5 동시 위반

#### [SEC-5] 반납 시 이중 상태(Asset.status+returned_at) 동시 갱신
- 위치: rentals.py:70-74; assets.py:60 (is_available_now)
- 심각도: Low / Confidence: Medium / 영역: P6 구성/정합성
- 이슈: §2 단일 진실 원천 ❌예시와 일치. availability가 두 소스 AND 결합. 한쪽만 갱신 시 가용성 판단 어긋남.
- 차단: No / 컨벤션: §2

### 결합 시나리오
[COMBO-1] 저장형 XSS(SEC-2) + 진단 로깅(SEC-3) + 헤더 기반 신원 → 무클릭 계정 사칭. 결합 시 Critical. 장비명 악성 HTML→피해자 화면 열면 자동 실행→localStorage userId 탈취→X-User-Id 세팅해 즉시 사칭.
[COMBO-2] 반납 IDOR(SEC-1) + 순차 정수 ID + 이중 상태(SEC-5) → 전사 대여 대량 조작. 결합 시 Critical. rental_id 1..N 순회 반납 모두 성공 + Asset.status 전환.

### 비계획 발견
[UNPLANNED-SEC-1] extend_rental의 extra_days에 하한 검증 없음 — 음수/0 허용 시 due_at 과거로 당겨 조기 회수. Confidence Medium.
[UNPLANNED-SEC-2] CORS allow_methods/headers=["*"] + allow_credentials=True (allow_origins는 단일 origin 한정이라 현재 안전). Confidence Low.
[UNPLANNED-SEC-3] ReturnExtend가 client.ts 안전 헬퍼 우회해 직접 fetch, authHeaders() 미경유. Low.

### 검토 안 한 영역: create_rental 동시성(§5, diff 밖), 자산명 입력 경로, 운영 빌드 설정.

### 요약: 총 5개(Critical 1/High 1/Medium 2/Low 1) + 비계획 3. 차단 2(SEC-1, SEC-2). 결합 2.

</details>

<details>
<summary>Performance Review</summary>

## Performance Review

### 발견 사항

#### [PERF-1] GET /assets/availability/all — 장비당 1쿼리 N+1 (미인덱스 풀스캔 동반)
- 위치: backend/app/routers/assets.py:46-65
- 심각도: High / Confidence: High / 영역: P1 쿼리
- 이슈: assets 전체 조회 후 for asset in assets 루프에서 장비마다 db.query(Rental).filter(asset_id==, returned_at IS NULL).first() 호출. N개면 1+N round-trip. Rental.asset_id, Rental.returned_at에 인덱스 없어(models/rental.py) 각 .first()가 rentals 풀스캔.
- 영향: 장비 N·rentals R → 쿼리 N+1회, 각 O(R) → O(N·R). 장비 500·rentals 5만이면 501쿼리×5만행. 핫패스.
- 수정: 단일 쿼리 일괄 조회 후 dict 매핑 또는 outerjoin. Rental.asset_id/returned_at 인덱스 추가.
- 차단: No / 컨벤션: §1 (Router가 직접 쿼리/도메인 계산)

#### [PERF-2] ReturnExtend.reload() — 대여 건당 1 HTTP 요청 워터폴 (프론트 N+1)
- 위치: frontend/src/pages/ReturnExtend.tsx:14-23
- 심각도: High / Confidence: High / 영역: P4 프론트
- 이슈: fetchMyRentals() 후 Promise.all(list.map(fetch(/assets/{id})))로 대여 1건당 GET /assets/{id}. M건이면 1+M 왕복. 반납/연장 후 reload()가 매번 전체 재실행. 전체 대여(반납완료 포함) fetch 후 화면 filter라 이력 쌓일수록 버려지는 요청 증가.
- 수정: 백엔드 일괄 응답 또는 fetchAssets() 1회+Map 조인. filter를 fetch 이전으로.
- 차단: No

#### [PERF-3] fetchActiveAssetsForUser() — 미사용 의심 + 이중 fetch 후 잘못된 클라 필터
- 위치: frontend/src/api/client.ts:48-55
- 심각도: Medium / Confidence: Medium / 영역: P4/P3
- 이슈: fetchAssets() 후 fetchMyRentals() 순차 워터폴(병렬화 가능). filter 조건이 "대여 중이라도 status available이면 포함"이라 대여중 장비를 가용 노출(정확성 이슈는 성능 외). diff상 import 안 됨 — 죽은 코드 가능성.
- 수정: 호출처 확인 후 미사용이면 제거, 사용 시 Promise.all 병렬화.
- 차단: No

### 결합 시나리오
[COMBO-1] PERF-1 N+1 × 미인덱스 rentals 풀스캔 — 곱셈 폭발 O(N·R). High→데이터 증가 시 Critical 후보. 인덱스+일괄쿼리 함께 고쳐야.
[COMBO-2] 백엔드 N+1(PERF-1) × 프론트 워터폴(PERF-2) 같은 화면 중첩. 반납 1회→reload→클라 M+1 + 서버 N+1.

### 비계획 발견
[UNPLANNED-PERF-1] MyRentals 전체 대여 받아 클라 filter, 서버측 status 파라미터 없음. Low.
[UNPLANNED-PERF-2] ReturnExtend "3일"/"7일" 버튼 둘 다 handleExtend(id,3) 호출(라벨-동작 불일치). 정확성 이슈(성능 외 참고).
[UNPLANNED-PERF-3] return/extend 커밋 후 db.refresh 1회 추가 round-trip(단건, 무시 가능). Low.

### 검토 안 한 영역: 실측 프로파일링, fetchActiveAssetsForUser 호출처, 프론트 리렌더(key={index}, 객체 렌더마다 생성), 동시성 경합 비용.

### 요약: 총 6개(Critical 0/High 2/Medium 1/Low 3) 차단 0 비계획 3. 핵심: PERF-1, PERF-2, COMBO-1/2. 데이터 증가 시 availability+반납/연장 화면이 먼저 무너짐.

</details>

<details>
<summary>Test Coverage Review</summary>

## Test Coverage Review
신규 코드 경로 19개 중 happy path 2개만 테스트, 실패/권한/경계 경로 전부 무방비. commit이 약속한 동작(403/400/14일)조차 테스트 없어 깨뜨려도 CI 통과.

#### [TEST-1] 연장 권한 거부(403) 무방비 — commit 약속 핵심 규칙
- 위치: rentals.py:90-91 / 심각도 Critical / Confidence High / P2 권한거부+P1
- 이슈: "본인만 연장 403" 약속했으나 테스트 0개. 분기 삭제/== 오타해도 통과. test_extend_rental_success는 alice→alice라 경로 안 탐.
- 추가 테스트: test_extend_other_users_rental_forbidden (bob이 alice 대여 연장→403 + due_at 불변). 차단: Yes / §6,§4

#### [TEST-2] 14일 초과 연장 거부 경계 무방비
- 위치: rentals.py:96-98 / High / High / P2 경계+P1
- 추가: test_extend_at_limit_allowed(extra_days:7→200), test_extend_over_limit_rejected(extra_days:8→400 extend_limit_exceeded+due_at 불변). 차단: Yes / §6

#### [TEST-3] 음수 extra_days 무방비 — due_at 역행
- 위치: rentals.py:100 + RentalExtend.extra_days:int(하한 없음) / High / High / P2 음수
- 이슈: -3 전달 시 extended_days=4로 통과, due_at 과거로 되감김. 가장 조용히 머지될 위험.
- 추가: test_extend_negative_days_rejected(-3→422/400, due_at 단축 안 됨). 차단: Yes

#### [TEST-4] 이미 반납된 대여 재반납/재연장(400) 무방비 — 상태 전이
- 위치: rentals.py:65-66, 92-93 / High / High / P2 상태전이+P1
- 추가: test_return_already_returned_rental_400, test_extend_already_returned_rental_400. 차단: Yes / §6

#### [TEST-5] 없는 rental_id(404) 무방비 return/extend
- 위치: rentals.py:63-64, 88-89 / Medium / High / P1+P2
- 추가: test_return/extend_nonexistent_rental_404. 차단: No

#### [TEST-6] 반납 인증/권한 누락 — return에 소유권 체크 자체 없음(테스트도 미포착)
- 위치: rentals.py:58-72 / High / High / P2 권한거부
- 이슈: return에 소유권 검증 없어 남의 대여 반납 가능. 그것을 잡을 테스트 부재가 본 리뷰 지적. 401도 미검증.
- 추가: test_return_other_users_rental_forbidden(bob→alice 대여 반납, 기대 403, 현재 코드 200이라 버그 드러냄), test_return_requires_auth(헤더 없이→401). 차단: Yes

#### [TEST-7] 프론트 "7일 연장" 버튼이 3일 연장(라벨-동작 불일치) 테스트 부재
- 위치: frontend/src/pages/ReturnExtend.tsx:78 (onClick handleExtend(id,3) "7일 연장") / High / High / P5
- 추가: ReturnExtend.test.tsx "7일 연장 클릭→fetch body extra_days:7" (현재 3이라 실패하며 버그 드러냄). 차단: Yes

#### [TEST-8] 프론트 연속 클릭(더블 반납/연장) 무방비 — 버튼 disable 없음
- 위치: ReturnExtend.tsx:36-58 / Medium / Medium / P2 중복+P5
- 추가: 반납 2회 연속 클릭→PATCH 1회만/버튼 disabled. 차단: No

#### [TEST-9] GET /assets/availability/all 전체 무방비
- 위치: assets.py:45-65 / Medium / High / P1+P2
- 이슈: is_available_now, next_available_at 분기 미검증. 대여중/maintenance 자산 조합 무방비. 이중 상태 불일치 잡을 테스트 없음.
- 추가: test_availability_rented_asset_not_available, test_availability_maintenance_asset, test_availability_free_asset. 차단: No

#### [TEST-10] 기존 happy-path 어서션 약함 — DB 상태 변화 미검증(거짓 안심)
- 위치: backend/tests/test_rentals.py:60-69 (test_extend_rental_success) / Medium / High / P3 품질
- 이슈: status_code 200만 단언, due_at +3일 안 봄. return도 returned_at만 보고 asset.status 복귀 안 봄.
- 추가: due_at +3일 단언, 반납 후 availability is_available_now 확인. 차단: No

### 결합 시나리오
[COMBO-1] 권한 버그 + 권한 테스트 부재 = 권한 우회 무방비 머지. TEST-1+TEST-6 함께 추가해야 권한 경계 닫힘.
[COMBO-2] 음수 + 14일 한계 + 프론트 라벨불일치 = 데이터 조작 경로. TEST-3+TEST-2+TEST-7 함께.
[COMBO-3] 이중 상태(§2) + availability 테스트 부재 = 불일치 조용히 노출. TEST-9가 드러냄.

### 비계획 발견
[UNPLANNED-TEST-1] handleError/fetchActiveAssetsForUser 헬퍼 테스트 0개. Low.
[UNPLANNED-TEST-2] AssetList 검색/필터 로직 테스트 0개, 빈 상태 미검증. Low.
[UNPLANNED-TEST-3] AssetList key={index} 정렬/필터 시 재조정 버그 가능. Low.
[UNPLANNED-TEST-4] MyRentals 필터 버튼이 useEffect 의존성에서 filter 누락 — 버튼 눌러도 재조회 안 됨 가능. Medium.

### 검토 안 한 영역: 테스트 실행 미수행, 동시성(StaticPool 한계), ReturnExtend N+1 fetch 실패 동작.

### 요약: 총 14개(Critical 1/High 6/Medium 4/Low 3, UNPLANNED 4 포함) 차단 5 비계획 4. 가장 위험: return 소유권 검증 없어 남의 대여 반납 가능한데(TEST-6) 잡을 테스트 전무 → 권한 우회가 그린 CI에 가려 조용히 머지.

</details>

<details>
<summary>Architecture Review</summary>

## Architecture Review
상태 흐름 추적: create_rental(service)은 대여 생성 시 Asset.status 변경 안 함. "사용 중" 판정은 오직 Rental.returned_at IS NULL — §2 ✅예시와 일치하게 이미 설계됨. 신규 코드가 이 설계를 깸.

#### [ARCH-1] 반납 라우터에 비즈니스 로직 전체(Service 미위임)
- 위치: rentals.py:60-78 (return_rental) / High / High / §1 A1
- 이슈: create_rental/list_my_rentals는 service 위임하는데 return_rental만 조회/상태판단/상태변경/db.commit()을 라우터 직접. 단위 테스트 불가, 일관성 붕괴.
- 수정: rental_service.return_rental로 추출. 차단: Yes

#### [ARCH-2] 이중 상태(SSoT 위반) — Asset.status와 returned_at 둘 다로 가용성 판정
- 위치: assets.py:61 (is_available_now=active_rental is None and asset.status=="available") + rentals.py:73-75 (반납 시 asset.status="available") / Critical / High / §2 A2
- 이슈: §2 ❌예시와 글자 그대로 일치. 대여 생성은 status 안 바꾸므로 두 소스 비동기화. (a)maintenance 장비 반납 시 status=available로 덮어써 점검상태 소실 (b)대여/반납 비대칭.
- 수정: 가용 판정 SSoT를 returned_at IS NULL 하나로. asset.status는 maintenance/retired 전용. 반납 시 status 쓰기 제거. 차단: Yes

#### [ARCH-3] 연장 권한 체크가 Service 아닌 Router
- 위치: rentals.py:91-92 / High / High / §4 A4 + §1
- 수정: rental_service.extend_rental로 추출, 소유권/한도 검증 Service. 차단: Yes

#### [ARCH-4] 반납에 소유권 검증 부재 — user_id 받았으나 권한 판단 안 씀
- 위치: rentals.py:61-78 / High / High / §4 A4
- 이슈: extend는 체크하는데 return은 user_id 받기만 하고 검증 안 함. alice가 bob 대여 반납 가능. A4 정확한 시그니처. ARCH-2 상태 덮어쓰기를 임의 사용자가 트리거→COMBO-1.
- 수정: Service에서 rental.user_id==user_id 검증 후 403. 차단: Yes

#### [ARCH-5] "확인 후 변경" 사이 락/제약 부재 (동시성 무방비)
- 위치: rental_service.py:19-35 + rentals.py:66-77 / Medium / Medium / §5 A5
- 이슈: create_rental SELECT 후 INSERT 사이 락/유니크 없어 동시 두 건 가능. 신규 반납/연장도 read-modify-write 보호 없음.
- 수정: rentals(asset_id) WHERE returned_at IS NULL 부분 유니크 또는 행 락. 차단: No

#### [ARCH-6] availability 도메인 조회를 라우터에서 + 인라인 DTO 변환
- 위치: assets.py:44-65 / Medium / High / §1 A1, 부수 §3
- 이슈: DTO는 §3 지킴(좋음). 그러나 가용 판정 도메인 규칙+N+1 조회가 라우터에. service create_rental의 returned_at 조회와 중복+기준 다름(여기선 +status AND). A6.
- 수정: service로 추출, 가용 판정 단일 함수. 차단: No

#### [ARCH-7] 연장 한도가 누적 아닌 "원기간+이번추가분"이라 반복 연장으로 MAX 우회
- 위치: rentals.py:96-100 / Medium / High / §1 A1 + 규칙 정합성
- 이슈: extended_days=(due_at-started_at).days+extra_days. due_at은 이전 연장 누적 반영값. 7일→3일연장(10)→다시 3일(13)→또 3(16) 여러 번으로 14일 초과 가능. 규칙이 라우터에 박혀 단위테스트 어려움.
- 수정: Service에서 누적 기준 검증. 차단: No

#### [ARCH-8] 프론트가 백엔드 우회해 가용성 규칙 클라이언트 재구현
- 위치: client.ts:48-56 (fetchActiveAssetsForUser), ReturnExtend.tsx:14-25 / Low / Medium / §2/§1 클라 누수
- 이슈: availability 엔드포인트 추가해놓고 프론트는 mine.filter(returned_at===null)+status로 재구현(백엔드 ARCH-2 이중기준 복제). BASE 중복 정의, ReturnExtend가 client 헬퍼 우회 직접 fetch.
- 수정: 가용성은 availability 엔드포인트만 신뢰. 차단: No

### 결합 시나리오
[COMBO-1] 무권한 반납(ARCH-4) + SSoT 위반 상태 덮어쓰기(ARCH-2) → 임의 사용자가 maintenance 장비 대여를 반납→status=available로 덮여 점검 장비가 대여 가능 목록 노출. 운영 사고로 격상. 보안 권한누락의 구조적 뿌리는 §4+§2.
[COMBO-2] 라우터 로직 분산(ARCH-1/3/7) + 동시성 무방비(ARCH-5) → 트랜잭션 일관성 회귀. 로직 흩어지면 동시성 보호를 한 곳에 못 넣음.

### 비계획 발견
[UNPLANNED-ARCH-1] ReturnExtend "7일 연장" 버튼이 handleExtend(id,3) (복붙 버그).
[UNPLANNED-ARCH-2] ReturnExtend dangerouslySetInnerHTML asset_name (XSS, 보안 영역).
[UNPLANNED-ARCH-3] AssetList key={index} 재조정 버그.
[UNPLANNED-ARCH-4] MyRentals useEffect 의존성 [] — filter 버튼 동작 안 함.
[UNPLANNED-ARCH-5] handleError 헤더 전체+userId console 로깅 (보안 영역).

### 검토 안 한 영역: 런타임 동시성 실측, ARCH-7 반복연장 실제 DB 상태, vitest 컴포넌트 테스트 부재(§6 대비 권한거부/경계/동시성 테스트 전부 부재), DB 마이그레이션/제약.

### 요약: 총 8개(Critical 1/High 3/Medium 3/Low 1) 차단 4(ARCH-1,2,3,4) 비계획 5 결합 2. 가장 큰 구조적 위험: 신규 코드가 로직·권한을 라우터로 끌어내리고(§1·§4), returned_at 단일 원천 설계에 Asset.status 재결합(§2)해 점검 자산이 무권한 반납으로 대여 가능해지는 불일치 경로(COMBO-1)를 열었다.

</details>
