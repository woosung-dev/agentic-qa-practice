# 통합 코드 리뷰 리포트

> Target: `feat/review-brit` → `main`
> Reviewer: 합의 기반 멀티 에이전트 (5 agents: security / performance / test-coverage / architecture + consensus-synthesizer)
> Generated: 2026-05-28T12:31:48Z
> Commits: 6개
> 변경: 11파일 / +355 -35줄

## Executive Summary

> **이 PR이 머지되면 가장 큰 위험은 반납 API(`PATCH /rentals/{id}/return`)의 소유권 검증 부재(IDOR)로 누구나 `rental_id`만 알면 타인의 대여를 임의 반납·자산 상태 변경할 수 있고, 이를 잡을 테스트조차 없어 회귀로 영구화된다는 점입니다.**

**결정**: ☑ Request changes (차단 이슈 해소 후 재리뷰)

| 심각도 | 개수 | 차단 |
|---|---|---|
| Critical | 2 | 2 |
| High | 5 | 4 |
| Medium | 4 | - |
| Low | 3 | - |
| **총** | **14** | **6** |

**비계획 발견**: 4개 (PR 의도 외 — 7일 연장 버튼 버그, 연장 상한 계산 결함, key={index}, CSRF 부재)
**결합 시나리오**: 3개 (단독 High가 결합 시 Critical)

**핵심 권고**:
- 신규 반납/연장 로직을 `rental_service`로 끌어내리는 단일 리팩터가 차단 이슈(레이어·권한·트랜잭션·SSOT)를 동시 해소한다.
- PR이 commit에서 약속한 동작 명세(403/400/404/MAX 14)를 그대로 테스트로 옮기면 무테스트 차단 4건이 해소되고, 권한 테스트는 추가 즉시 IDOR 버그를 FAIL로 폭로한다.
- 가용성은 `Rental.returned_at IS NULL` 단일 출처로 판정(§2), `asset.status` AND 조건 제거.

---

## Critical Findings (반드시 수정)

### [#1] 반납 API 소유권 검증 부재 (IDOR) + 이를 잡을 테스트 전무
- **발견자**: Security Specialist (SEC-1) + Test Coverage Reviewer (TEST-1) + Architecture Guardian (ARCH-2) — **3중 공동 발견**
- **위치**: `backend/app/routers/rentals.py:60-78` (`return_rental`)
- **Confidence**: High
- **이슈**: `return_rental`은 `user_id = Depends(current_user)`를 선언만 하고 본문에서 *전혀 사용하지 않는다*. 형제 함수 `extend_rental`은 `if rental.user_id != user_id: 403` 가드가 있는데 반납에는 없다 → 임의 인증 사용자가 `rental_id`만 알면 남의 대여를 강제 반납하고 `asset.status`를 `available`로 바꿀 수 있다. 게다가 이 분기를 검증하는 테스트가 0개라, happy path(alice→alice)는 초록불을 유지하며 버그를 가린다.
- **수정 방향**: 소유권 검사를 추가하되 §4에 따라 `rental_service.return_rental(db, rental_id, user_id)`로 옮겨 `ValueError("not_your_rental")` 발생. 동시에 `test_return_others_rental_forbidden`(타인 반납 시 403) 추가 — 추가 즉시 현재 코드는 FAIL하며 버그를 폭로.
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §4 "반납 처리 전 `rental.user_id == current_user_id` 검증" 정면 위반, §6 "권한 거부는 별도 테스트 케이스로"

### [#2] 저장된 사용자 입력의 `dangerouslySetInnerHTML` 렌더링 → Stored XSS (회귀 테스트 없음)
- **발견자**: Security Specialist (SEC-2) + Test Coverage Reviewer (TEST-8) + Architecture Guardian (UNPLANNED-ARCH-2)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:71` (`dangerouslySetInnerHTML={{ __html: rental.asset_name }}`)
- **Confidence**: High
- **이슈**: DB 저장값인 `asset.name`을 sanitize 없이 `dangerouslySetInnerHTML`로 렌더 → asset 이름에 `<img src=x onerror=...>` 페이로드가 있으면 반납/연장 화면을 여는 모든 사용자 브라우저에서 스크립트 실행. 정당한 신뢰 HTML 사유 없음. vitest 인프라는 깔렸으나 이 sink를 고정하는 회귀 테스트가 없다(PR이 TODO로 명시).
- **수정 방향**: `dangerouslySetInnerHTML` 제거 후 평문 렌더(`{rental.asset_name ?? '(이름 없음)'}`). HTML 필요 시 DOMPurify. 회귀 테스트: `expect(container.querySelector('img[onerror]')).toBeNull()`.
- **차단 여부**: **Blocking**
- **컨벤션 위반**: security-reviewer P3

---

## High Priority (수정 권장)

### [#3] 신규 반납/연장 엔드포인트가 `rental_service`를 우회하고 Router에서 직접 DB/모델 조작
- **발견자**: Architecture Guardian (ARCH-1)
- **위치**: `backend/app/routers/rentals.py:60-103`
- **Confidence**: High
- **이슈**: `create_rental`은 `rental_service`에 100% 위임하는데, 신규 `return_rental`/`extend_rental`은 `db.get`/`db.query`/상태변경/`db.commit`을 Router 본문에서 직접 수행. service에 해당 함수가 *존재하지 않는다*. 도메인 규칙(반납 판정·연장 상한 계산·Asset 동기화)이 Router로 누수.
- **수정 방향**: `rental_service.return_rental` / `extend_rental` 신설, 조회·판정·상태변경·commit 전부 이동. **이 단일 리팩터가 #1·#5·COMBO-1을 동시 해소하는 지점.**
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §1, §5, §6

### [#4] `GET /assets/availability/all` N+1 쿼리 + 조회 컬럼 인덱스 부재 (쿼리 로직 3중 중복)
- **발견자**: Performance Analyst (PERF-1, PERF-2) + Architecture Guardian (ARCH-4)
- **위치**: `backend/app/routers/assets.py:45-65` (루프 내 쿼리 :49-53), `backend/app/models/rental.py`
- **Confidence**: High
- **이슈**: 전체 자산을 `.all()` 후 루프에서 자산마다 active rental 조회 → 자산 N개면 1+N 쿼리. `Rental.asset_id`/`returned_at`/`user_id` 인덱스가 없어 각 서브쿼리가 풀스캔(O(N·M)). 동일 쿼리가 service·assets 라우터에 복붙됨(§1 라우터 직접 쿼리 위반).
- **영향 추정**: N=1k·M=10k → 요청당 천만 행 스캔, SQLite 단일 커넥션에서 동시 요청 시 타임아웃.
- **수정 방향**: active rental을 한 번에 받아 dict 매핑하거나 `outerjoin`. `asset_id`/`(user_id, returned_at)` 인덱스 추가. 조회는 `rental_service.get_active_rental`로 단일화.
- **차단 여부**: **Blocking** (데이터 증가 시 엔드포인트 붕괴)

### [#5] Asset.status와 Rental.returned_at 이중 상태 — SSOT 위반 (상태 전이 테스트 부재)
- **발견자**: Architecture Guardian (ARCH-3) + Test Coverage Reviewer (TEST-6)
- **위치**: `backend/app/routers/rentals.py:72-75`, `backend/app/routers/assets.py:61`
- **Confidence**: High
- **이슈**: §2가 *문자 그대로 금지한 패턴*. "사용 중"을 `returned_at`과 `asset.status` 두 곳으로 판단·기록. 생성 경로는 `asset.status`를 안 건드려 이미 비대칭. `availability/all`이 두 출처를 AND 결합해 어긋나면 가용 판정 오류. 재반납/재대여/가용성 상태 전이 테스트 모두 없어 불일치 무탐지.
- **수정 방향**: 가용 여부는 `returned_at IS NULL`만으로 판정, AND 조건에서 `asset.status` 제거, 반납 시 `asset.status` 토글 제거(또는 유지보수 전용 한정).
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §2

### [#6] 연장 한도 경계값(MAX_EXTEND_DAYS=14) 테스트 전무 + 계산 기준 결함
- **발견자**: Test Coverage Reviewer (TEST-3) + Architecture Guardian (UNPLANNED-ARCH-1)
- **위치**: `backend/app/routers/rentals.py:91-93`
- **Confidence**: High
- **이슈**: 경계 로직 `(due_at - started_at).days + extra_days > 14`. happy path는 `extra_days=3`만 테스트 → off-by-one(`>` vs `>=`)이나 `.days` 절삭 버그를 못 잡는다. 또한 계산이 *이미 연장된 due_at*이 아니라 매번 started_at 기준 재계산이라, 반복 연장 시 상한이 무력화될 수 있음(구조 결함이 로직 결함을 은폐).
- **수정 방향**: 경계 직전(7+7=14 통과)/직후(7+8=15 거부) 테스트 추가, `extra_days` 0/음수 검증 추가, 누적 연장 기준을 명확히.
- **차단 여부**: Non-blocking (단, #3 리팩터 시 함께 처리 권장)

### [#7] `ReturnExtend.reload()` — 대여 건마다 자산 상세 직렬 fetch (프론트 N+1)
- **발견자**: Performance Analyst (PERF-4)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:16-25`
- **Confidence**: High
- **이슈**: `list.map(async r => fetch('/assets/{id}'))`로 대여 K건마다 개별 HTTP 요청. 반납/연장 후 매번 `reload()`로 재발생. K=100이면 101 요청 + 백엔드 자산 단건 조회 100회.
- **수정 방향**: 이미 추가된 `GET /assets/availability/all`로 일괄 조회하거나, rental 응답에 asset_name을 서버 join으로 포함.
- **차단 여부**: Non-blocking

---

## Combined Risks (결합 시나리오)

### [COMBO-1] Stored XSS → userId 탈취 → IDOR 대량 반납
- **결합 발견**: #2 (XSS) + #1 (반납 권한 부재) + SEC-3 (userId 콘솔 로깅)
- **결합 시 심각도**: **Critical** (단독은 각각 High/Medium)
- **공격 경로**: ① XSS로 `localStorage.getItem('userId')` 탈취(handleError가 동일 값을 콘솔에도 노출). ② 본 인증 모델에서 userId = `X-User-Id` 자격증명 전체이므로 즉시 완전 사칭. ③ #1과 결합하면 사칭조차 불필요 — 자기 계정으로 순차 `rental_id`를 돌려 전체 사용자 대여를 반납시키고, XSS가 이를 자동·무차별 확산.
- **권고**: #1·#2·SEC-3 *모두* 수정해야 결합 위험 제거.

### [COMBO-2] N+1 + 인덱스 부재 + 페이지네이션 부재 = availability 타임아웃
- **결합 발견**: PERF-1 + PERF-2 + PERF-3 (#4에 통합)
- **결합 시 심각도**: **Critical** (데이터 증가 시)
- **실패 경로**: 페이지네이션 없음(자산 전수 루프) × N+1 × 인덱스 없는 풀스캔 = O(N·M). 동시 요청 시 SQLite 직렬화로 처리량 붕괴.

### [COMBO-3] SSOT 위반 → 데이터 불일치 → 권한·가용 판정 오류
- **결합 발견**: #5 + #1 + availability 판정
- **결합 시 심각도**: High
- **실패 경로**: 두 상태 출처가 어긋나면 가용 판정이 틀어지고, #1의 반납 권한 미검사와 결합하면 타인이 임의 반납으로 `asset.status`를 강제 변경해 가용 상태를 외부에서 흔드는 구조적 경로 형성.

---

## Unplanned Findings (비계획 발견) 🎯

PR 의도 외에 자연스럽게 발견된 것들. 워크숍 가치 측정의 핵심.

- **[UNPLANNED-1]** "3일 연장"/"7일 연장" 버튼이 **둘 다 `handleExtend(rental.id, 3)`** 호출 — 7일 버튼이 3일만 연장. 명백한 기능 버그. (발견자: Test Coverage UNPLANNED-3 + Architecture UNPLANNED-2 / `ReturnExtend.tsx`)
- **[UNPLANNED-2]** 연장 상한 계산이 started_at 기준 재계산이라 반복 연장 시 한도 우회 가능. (발견자: Architecture UNPLANNED-1)
- **[UNPLANNED-3]** PATCH 상태변경 엔드포인트에 CSRF 보호 부재 — 현재 커스텀 헤더 인증이라 영향 제한적이나 쿠키 인증 전환 시 one-click CSRF로 악화, #1과 결합 시 CSRF+IDOR. (발견자: Security UNPLANNED-1)
- **[UNPLANNED-4]** `AssetList.tsx` 리스트 `key={index}` — 필터/정렬로 순서 변동 시 React 재조정 오류, 잘못된 대상 조작·재렌더 비용. (발견자: Security UNPLANNED-2 + Performance PERF-7 + Architecture UNPLANNED-3 — **3중 공동**)
- **[UNPLANNED-5]** `vitest.config.ts` include 패턴이 존재하는 테스트 0개를 가리켜 "CI 테스트 통과"가 공집합 통과(거짓 안심). (발견자: Test Coverage UNPLANNED-2)

---

## Medium / Low (참고)

> 다음 이터레이션 후보.

- [#8] `return_rental` 실패 경로(404/400 재반납) 무테스트 — Medium / Test TEST-2 / Non-blocking
- [#9] `extend_rental` 권한(403)/재처리(400)/없는 id(404) 분기 무테스트 — Medium / Test TEST-4 / Non-blocking
- [#10] `list_assets_with_availability` 신규 엔드포인트 0% 커버 — Medium / Test TEST-7 / Non-blocking
- [#11] 응답 전체를 받아 클라이언트 필터/정렬 (서버 푸시다운 필요) — Medium / Perf PERF-5 / Non-blocking
- [#12] `AssetList` 매 키 입력마다 filter+sort 재계산 (useMemo 부재) — Low / Perf PERF-6 / Non-blocking
- [#13] `MyRentals` useEffect deps에 filter 누락 (stale) — Low / Perf PERF-8 + Test TEST-9 / Non-blocking
- [#14] handleError 과도 로깅 (userId/전체 헤더 console 출력) — Medium / Security SEC-3 / Non-blocking (COMBO-1 구성요소)

---

## 충돌 해결 기록

| 항목 | 충돌 내용 | 결정 | 이유 |
|---|---|---|---|
| 권한 위치 | Arch는 "권한을 Service로", 현재 코드는 Router에서 체크(extend) | Service로 이동 우선 | §4 명시 + #3 리팩터와 동일 방향, 충돌 아닌 보강 |
| asset.status | Test는 "복원 동작 검증 필요", Arch는 "토글 자체를 제거(SSOT)" | Arch 우선(제거) | §2가 이중 상태를 금지 — 제거하면 검증 대상 자체가 단순화 |

> 그 외 리뷰어 간 명시적 모순 없음. 대부분 같은 결함을 다른 축에서 본 *상호 보강*(예: #1은 보안·테스트·구조 3축이 동일 지점 지목).

---

## 다음 이터레이션 후보

- 서버측 필터/정렬/페이지네이션 푸시다운 (#11) — 데이터 증가 대비
- 프론트 컴포넌트 테스트 본격 도입 (AssetList 필터, MyRentals 필터, ReturnExtend XSS 회귀)
- 동시 반납/연장 낙관적 락·DB 제약 (§5 후단) + 동시성 테스트
- 타임존 경계(naive DB 저장 vs aware `datetime.now(UTC)`) 정합 점검

---

## 리뷰어별 원본 발견 사항

<details>
<summary>Security Review</summary>

SEC-1 반납 API 본인 권한 검증 누락(IDOR, High), SEC-2 dangerouslySetInnerHTML Stored XSS(High), SEC-3 handleError 과도 진단 로깅—응답 헤더+userId 노출(Medium). COMBO-1 XSS→userId 탈취→IDOR 대량 반납(Critical). UNPLANNED-SEC-1 PATCH CSRF 부재, UNPLANNED-SEC-2 key={index}. 요약: 총 3(High 2/Medium 1), 차단 2, 결합 시 Critical.

</details>

<details>
<summary>Performance Review</summary>

PERF-1 availability/all N+1(High), PERF-2 인덱스 부재(High), PERF-3 페이지네이션 부재(Medium), PERF-4 ReturnExtend 프론트 N+1 직렬 fetch(High), PERF-5 클라이언트 필터/정렬(Medium), PERF-6 매 렌더 재계산(Low), PERF-7 key={index}(Low), PERF-8 MyRentals 재fetch/deps(Low). COMBO-1 N+1+인덱스+페이지네이션=타임아웃(Critical), COMBO-2 프론트+백 N+1. UNPLANNED fetchActiveAssetsForUser 워터폴, handleError 헤더 직렬화. 요약: 총 8(High 4/Medium 2/Low 4), 차단 2~3.

</details>

<details>
<summary>Test Coverage Review</summary>

TEST-1 타인 반납 거부 테스트 전무(Critical), TEST-2 반납 404/400 무테스트(High), TEST-3 연장 한도 경계 무테스트(High), TEST-4 연장 권한/재처리/404 무테스트(High), TEST-5 연장 약한 단언(Medium), TEST-6 반납 부수효과 미검증(Medium), TEST-7 availability 0% 커버(Medium), TEST-8 프론트 테스트 0개+XSS 회귀 부재(High), TEST-9 MyRentals deps(Low). COMBO 1~3. UNPLANNED status-only 단언, 공집합 CI, 7일 버튼=3일. 요약: 총 9(Critical 1/High 4/Medium 3/Low 1), 차단 4.

</details>

<details>
<summary>Architecture Review</summary>

ARCH-1 service 우회·Router 직접 조작(Critical), ARCH-2 return vs extend 권한 패턴 불일치(High), ARCH-3 Asset.status/returned_at SSOT 위반(High), ARCH-4 active-rental 쿼리 3중 중복(Medium), ARCH-5 가용성 계산이 Router에·next_available_at 타입 불일치(Low). COMBO-1 service 우회→트랜잭션 경계 이동→부분 커밋, COMBO-2 SSOT→불일치→판정 오류. UNPLANNED 연장 상한 계산 결함, 프론트 레이어 우회+7일 버튼 버그, key={index}. 위반: §1/§2/§4/§5/§6. 요약: 총 5(Critical 1/High 2/Medium 1/Low 1), 차단 3.

</details>
