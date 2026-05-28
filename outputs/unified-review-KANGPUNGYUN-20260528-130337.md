# 통합 코드 리뷰 리포트

> Target: `feat/review-YUN` → `main`
> Reviewer: 합의 기반 멀티 에이전트 (5 agents: Security Specialist + Performance Analyst + Test Coverage Reviewer + Architecture Guardian + Consensus Synthesizer)
> Generated: 2026-05-28T00:00:00+09:00
> Commits: 6개
> 변경: 14파일 (backend 5 + frontend 7 + agents 3)

---

## Executive Summary

> **이 PR이 머지되면 가장 큰 위험은 반납 API에 소유권 검사가 없어 누구든 타인의 장비를 강제 반납할 수 있고, 이것이 XSS 취약점과 결합되면 공격자 한 명이 시스템 전체 대여 기록을 파괴할 수 있다는 점 입니다.**

**결정**: ☑ Block

| 심각도 | 개수 | 차단 |
|---|---|---|
| Critical | 6 | 6 |
| High | 5 | 2 |
| Medium | 4 | 0 |
| Low | 2 | 0 |
| **총** | **17** | **8** |

**비계획 발견**: 6개 (PR 의도 외 자연 발견)
**결합 시나리오**: 3개 (단독 평가로는 놓치기 쉬운 시너지 위험)

**핵심 권고** (3줄):
1. `return_rental()`에 즉시 소유권 검사(`rental.user_id != user_id → 403`) 추가 — 이것 하나가 가장 큰 보안 구멍이다.
2. `ReturnExtend.tsx:72`의 `dangerouslySetInnerHTML` 제거 및 일반 텍스트 렌더링으로 교체 — XSS 차단.
3. 반납/연장 로직을 `rental_service`로 이동하고, `asset.status` 전환 전 현재 상태 확인 로직 추가 — 아키텍처 일관성 + maintenance 버그 동시 해결.

---

## Critical Findings (반드시 수정)

### [#C-1] 반납 API 소유권 검사 누락 — 타인 대여 강제 반납 가능

> **중복 병합**: SEC-1 + TEST-1 + ARCH-3 — 3개 리뷰어 독립 발견 (가장 강한 합의 신호)

- **발견자**: Security Specialist + Test Coverage Reviewer + Architecture Guardian (3자 공동)
- **위치**: `backend/app/routers/rentals.py:60-78`
- **Confidence**: High
- **이슈**: `return_rental()`은 `user_id`를 파라미터로 받지만, `extend_rental()`(L91)과 달리 `rental.user_id != user_id` 비교를 전혀 수행하지 않는다. 인증된 모든 사용자가 임의의 `rental_id`로 타인의 대여를 반납 처리할 수 있다.
- **수정 방향**:
  ```python
  if rental.user_id != user_id:
      raise HTTPException(status_code=403, detail="본인 대여만 반납 가능합니다.")
  ```
  이후 로직 전체를 `rental_service`로 이동 (ARCH-1 해결과 동시 진행 권장).
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §4 (권한 검사 일관성)

---

### [#C-2] Stored XSS — DB 유래 데이터의 dangerouslySetInnerHTML 직접 삽입

> **중복 병합**: SEC-2 + ARCH-7 + UNPLANNED-TEST-1 — 3개 리뷰어 독립 발견

- **발견자**: Security Specialist + Architecture Guardian + Test Coverage Reviewer (3자 공동)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:72`
- **Confidence**: High
- **이슈**: `rental.asset_name`을 `dangerouslySetInnerHTML={{ __html: ... }}`에 sanitize 없이 직접 삽입. 장비 이름에 XSS 페이로드가 저장된 경우 모든 접속자에게 스크립트 실행됨.
- **수정 방향**: `dangerouslySetInnerHTML` 제거, `<span>{rental.asset_name}</span>` 등 일반 텍스트 렌더링으로 교체.
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §1 (안전하지 않은 패턴 도입)

---

### [#C-3] 7일 연장 버튼이 실제로 3일을 전달 — 복붙 실수

> **중복 병합**: UNPLANNED-SEC-1 + TEST-6 + UNPLANNED-ARCH-1 — 3개 리뷰어 독립 발견 (비계획 발견이지만 합의 강도 최상)

- **발견자**: Security Specialist + Test Coverage Reviewer + Architecture Guardian (3자 공동)
- **위치**: `frontend/src/pages/ReturnExtend.tsx:78`
- **Confidence**: High
- **이슈**: "7일 연장" 레이블의 버튼이 `extra_days=3`을 API에 전달. 3일 버튼을 복붙하면서 레이블만 변경한 전형적인 복붙 오류. 사용자는 7일 연장을 요청했으나 실제로 3일만 연장됨.
- **수정 방향**: `extra_days=7`로 수정. 테스트 추가 권장: 버튼 레이블과 전달 값 일치 검증.
- **차단 여부**: **Blocking**

---

### [#C-4] 반납 시 asset.status 무조건 덮어쓰기 — maintenance 상태 소멸 버그

> **중복 병합**: TEST-2 + ARCH-2 — 2개 리뷰어 독립 발견

- **발견자**: Test Coverage Reviewer + Architecture Guardian (공동)
- **위치**: `backend/app/routers/rentals.py:73-75`
- **Confidence**: High
- **이슈**: 반납 시 `asset.status = "available"` 무조건 실행. `maintenance` 또는 `retired` 상태 자산이 반납되면 해당 상태가 소멸되어 `available`로 복귀. 향후 `retired` 등 상태 추가 시 폐기 장비가 다시 대여 가능 상태가 됨.
- **수정 방향**:
  ```python
  if asset.status == "rented":
      asset.status = "available"
  # 그 외 상태(maintenance, retired 등)는 그대로 유지
  ```
  단일 진실 원천 원칙에 따라 Asset 상태는 Asset 도메인에서만 전환.
- **차단 여부**: **Blocking**
- **컨벤션 위반**: ARCHITECTURE.md §2 (단일 진실 원천)

---

### [#C-5] 백엔드 N+1 쿼리 — GET /assets/availability/all

- **발견자**: Performance Analyst
- **위치**: `backend/app/routers/assets.py:47-54`
- **Confidence**: High
- **이슈**: 자산 N개 루프 안에서 `Rental` 개별 조회. 자산 100개 → 101 쿼리. 동시 요청 10건 → 1,010 쿼리/초. 프로덕션 트래픽에서 DB 과부하로 서비스 지연 또는 다운 가능.
- **수정 방향**: active_rentals를 단일 쿼리로 조회 후 dict로 참조, 또는 JOIN 쿼리 활용.
  ```python
  active_rentals = {r.asset_id: r for r in db.query(Rental).filter(Rental.returned_at == None).all()}
  ```
- **차단 여부**: **Blocking**

---

### [#C-6] extra_days 음수/0 입력 — due_at 역행 또는 무의미 연장

- **발견자**: Test Coverage Reviewer
- **위치**: `backend/app/routers/rentals.py:23-24` (`RentalExtend` 스키마)
- **Confidence**: High
- **이슈**: `RentalExtend` 스키마에 `extra_days`의 `ge=1` 제약이 없음. 0 또는 음수 입력 시 `due_at`가 역행하거나 변화 없음. MAX_EXTEND_DAYS만 있고 최솟값 검증 부재.
- **수정 방향**:
  ```python
  extra_days: int = Field(..., ge=1, le=MAX_EXTEND_DAYS)
  ```
- **차단 여부**: **Blocking**

---

## High Priority (수정 권장)

### [#H-1] (Asset.status + Rental.returned_at) 이중 상태 관리 — 데이터 불일치 위험

- **발견자**: Architecture Guardian
- **위치**: `backend/app/routers/assets.py:61` / `backend/app/routers/rentals.py:75`
- **Confidence**: High
- **이슈**: 가용성 판단을 `asset.status`와 `rental.returned_at` 두 곳에서 중복 관리. 두 값이 불일치할 경우 가용성 정보가 엇갈림.
- **수정 방향**: 단일 기준 선택 후 나머지는 파생값으로 처리. ARCHITECTURE.md §2 준수.
- **차단 여부**: **Non-blocking** (C-4 수정과 함께 다루면 효율적)

---

### [#H-2] DB 인덱스 없는 컬럼 조합 — Rental.asset_id + returned_at

- **발견자**: Performance Analyst
- **위치**: `backend/app/models/rental.py:18,22`
- **Confidence**: High
- **이슈**: 두 컬럼 모두 `index=True` 없음. 가용성 조회 쿼리가 대여 기록 전체 풀 스캔. 기록 1만 건 시 100만 행 읽기/요청 발생 가능.
- **수정 방향**: `(asset_id, returned_at)` 복합 인덱스 추가.
- **차단 여부**: **Blocking** (C-5와 함께 수정 권장)
- **컨벤션 위반**: 성능 설계 누락

---

### [#H-3] Router에서 ORM 직접 접근 — 레이어 분리 완전 붕괴

- **발견자**: Architecture Guardian + Security Specialist (공동)
- **위치**: `backend/app/routers/rentals.py:60-103`
- **Confidence**: High
- **이슈**: 기존 `list_my_rentals`은 `rental_service`에 위임하는 패턴인데, 신규 `return_rental`/`extend_rental`은 Router에서 ORM 직접 접근. 파일 주석에 "비즈니스 로직은 services로 위임"이라고 명시되어 있으나 구현은 정반대. 다음 기여자가 잘못된 패턴 복제 위험.
- **수정 방향**: `rental_service.return_rental()`, `rental_service.extend_rental()` 함수 추출. 트랜잭션 경계도 service 레이어로 이동.
- **차단 여부**: **Non-blocking** (단독으로는 기능 버그 없음. 단, C-1 수정 시 함께 진행하면 1회 작업으로 해결)
- **컨벤션 위반**: ARCHITECTURE.md §1, §5

---

### [#H-4] MyRentals.tsx useEffect deps 누락 — 필터 동작 불가

> **중복 병합**: PERF-4 + TEST-7 — 2개 리뷰어 독립 발견

- **발견자**: Performance Analyst + Test Coverage Reviewer (공동)
- **위치**: `frontend/src/pages/MyRentals.tsx:12-24`
- **Confidence**: High
- **이슈**: `useEffect` deps가 `[]`라서 `filter` 상태 변경 시 재실행 없음. 필터 버튼이 UI에는 존재하지만 동작하지 않는 기능 버그.
- **수정 방향**: 전체 데이터를 한 번만 fetch 후 파생 계산으로 필터링.
  ```tsx
  const filtered = useMemo(() => rentals.filter(...), [rentals, filter]);
  ```
- **차단 여부**: **Blocking** (사용자에게 노출되는 기능 버그)

---

### [#H-5] ReturnExtend.tsx — api/client.ts 우회, authHeaders() 미사용

- **발견자**: Architecture Guardian
- **위치**: `frontend/src/pages/ReturnExtend.tsx:5,19,32-46`
- **Confidence**: High
- **이슈**: `fetch()`를 직접 호출하며 공통 `authHeaders()` 미사용. 인증 방식 변경 시 `ReturnExtend`만 401로 실패.
- **수정 방향**: `api/client.ts`의 공통 함수 활용으로 교체.
- **차단 여부**: **Non-blocking** (현재 워크숍 설정에서는 가짜 인증이지만 실제 인증 도입 시 즉시 장애)

---

## Combined Risks (결합 시나리오)

### [COMBO-1] Stored XSS → userId 탈취 → 타인 대여 강제 반납

- **결합 발견**: #C-2 (XSS) + SEC-3 (userId 평문 로깅) + #C-1 (소유권 누락)
- **결합 시 심각도**: Critical (단독은 각각 High / Medium / Critical)
- **공격/실패 경로**:
  1. 공격자가 `asset.name`에 XSS 페이로드 삽입 (예: `<script>fetch('/steal?u='+localStorage.getItem('userId'))</script>`)
  2. 피해자가 `ReturnExtend.tsx` 페이지 방문 시 스크립트 실행
  3. `localStorage`의 `userId` 외부 서버로 유출
  4. 공격자가 탈취한 `userId`로 PATCH /rentals/{id}/return 호출 → 소유권 검사 없으므로 타인 대여 반납 가능
  5. 시스템 전체 대여 기록 파괴 가능
- **권고**: C-1, C-2 모두 머지 전 수정 필수. SEC-3(userId 로깅 제거)도 동반 수정 권장.

---

### [COMBO-2] 반납 소유권 누락 + 순차 정수 rental_id — 대량 강제 반납

- **결합 발견**: #C-1 (소유권 누락) + 순차 정수 ID 설계
- **결합 시 심각도**: Critical
- **공격/실패 경로**:
  1. 인증된 임의 사용자가 `for id in range(1, 10000)` 루프
  2. 각 id에 대해 `PATCH /rentals/{id}/return` 호출
  3. 소유권 검사 없으므로 시스템 전체 대여가 반납 처리됨
  4. 모든 장비가 `available` 상태로 전환 — 운영 마비
- **권고**: C-1 수정만으로 이 시나리오는 차단됨. 단, rate limiting도 장기적으로 추가 권장.

---

### [COMBO-3] 비즈니스 로직 Router 위치 + 권한 누락 — 구조적 취약점 영구화

- **결합 발견**: #H-3 (Router에 로직) + #C-1 (권한 누락)
- **결합 시 심각도**: Critical (ARCH-1 단독은 High, SEC-1 단독은 Critical이나 구조가 수정을 어렵게 함)
- **공격/실패 경로**:
  1. 현재 잘못된 패턴(Router에 ORM 직접)이 코드베이스에 고착됨
  2. 다음 기여자가 동일 패턴으로 신규 API 추가 → 권한 검사도 누락 패턴 복제
  3. 보안 패치가 Router 파일에 분산 → 일관성 없는 부분 수정으로 보안 구멍 잔존
- **권고**: C-1 수정과 H-3(service 레이어 이동)을 동일 PR에서 처리해야 재발 방지.

---

## Unplanned Findings (비계획 발견)

PR 의도 외에 자연스럽게 발견된 것들. 워크숍 가치 측정의 핵심.

- [UNPLANNED-1] **7일 버튼이 3일 호출** — Security Specialist + Test Coverage Reviewer + Architecture Guardian (3자 독립 발견 / `ReturnExtend.tsx:78`)
- [UNPLANNED-2] **reload() 내 에러 핸들링 부재** — Security Specialist (`ReturnExtend.tsx`: 반납/연장 후 reload 실패 시 무음 실패)
- [UNPLANNED-3] **CORS allow_methods=["*"] 설정** — Security Specialist (불필요한 HTTP 메서드 허용)
- [UNPLANNED-4] **dangerouslySetInnerHTML XSS** — Security Specialist + Architecture Guardian + Test Coverage Reviewer (3자 독립 발견 / `ReturnExtend.tsx:72` — C-2로 Critical 등재)
- [UNPLANNED-5] **conftest.py fixture 부재** — Test Coverage Reviewer (테스트 기반 인프라 누락, 테스트 확장성 저해)
- [UNPLANNED-6] **라우터 경로 충돌 가능성** — Architecture Guardian (`/rentals/{id}/return` vs `/rentals/{id}/extend` 경로 설계 점검 필요)

---

## Medium / Low (참고)

> 다음 이터레이션에서 다룰 항목들.

- [#M-1] **handleError에서 userId 평문 로깅** — Security Specialist / `frontend/src/api/client.ts:32` / Non-blocking (모든 응답 헤더 + userId 일괄 console.error)
- [#M-2] **localStorage에 userId 평문 저장** — Security Specialist / `client.ts:5`, `ReturnExtend.tsx:34,46` / Non-blocking (워크숍 설계상 가짜 인증이나 실 서비스 전환 시 즉시 위험)
- [#M-3] **fetchActiveAssetsForUser() 직렬 API 호출** — Performance Analyst / `client.ts:52-59` / Non-blocking (`Promise.all` 병렬화로 RTT 절약)
- [#M-4] **MAX_EXTEND_DAYS = 14가 Router 파일에 정의** — Architecture Guardian / `rentals.py:16` / Non-blocking (설정 파일 또는 service 상수로 이동)
- [#M-5] **프론트엔드 N+1 HTTP 요청 — reload()** — Performance Analyst / `ReturnExtend.tsx:16-24` / Non-blocking (대여당 GET /assets/{id} 개별 호출)
- [#M-6] **due_at 날짜 정확성 검증 누락** — Test Coverage Reviewer / `test_rentals.py:60-69` / Non-blocking (Half-assertion, 날짜 계산 정확성 미검증)
- [#L-1] **key={index} 사용** — Performance Analyst / `AssetList.tsx:74-80` / Non-blocking (`key={asset.id}`로 교체)
- [#L-2] **availability/all 엔드포인트 인증 없음** — Security Specialist / `assets.py:45` / Non-blocking (대여 현황 누출, 워크숍 범위에서는 수용 가능)

---

## 충돌 해결 기록

| 항목 | 충돌 내용 | 결정 | 이유 |
|---|---|---|---|
| #H-3 (Router 레이어 붕괴) | Security Specialist: "SEC-5, SEC-1과 결합 시 차단" / Architecture Guardian: "단독 차단" / Test Coverage Reviewer: "비계획 발견으로 언급" | Non-blocking (단독) + Blocking (C-1과 결합 시) | 코드 품질 관점에서 단독으로는 즉시 차단 사유 아님. 단, C-1 수정과 동반 진행 강력 권고 |
| #H-4 (useEffect deps 누락) | Performance Analyst: Non-blocking / Test Coverage Reviewer: Blocking (기능 버그) | Blocking | 사용자에게 노출되는 기능(필터)이 동작하지 않는 것은 기능 버그로 분류. 테스트 리뷰어 판단 채택 |
| #C-5 N+1 쿼리 | Performance Analyst: Critical / 보안·테스트·아키텍처: 미발견 | Critical 유지 | 서비스 다운 가능성 있는 성능 버그로 단독 발견이더라도 Critical 유지 |

---

## 다음 이터레이션 후보

> 이번 PR엔 Non-blocking이지만 다음 PR에서 다루면 좋을 항목.

1. **인증 체계 실질화**: `localStorage` userId → 서버 세션 또는 JWT로 교체 (M-2 근본 해결)
2. **Service 레이어 완성**: `return_rental`, `extend_rental`의 service 분리 완료 후, 권한 검사 미들웨어 또는 데코레이터 도입
3. **DB 인덱스 마이그레이션**: `(asset_id, returned_at)` 복합 인덱스 Alembic 마이그레이션으로 추가
4. **통합 테스트 픽스처 정비**: `conftest.py` fixture 체계화 + 경계값 테스트(음수, 0, MAX 초과) 자동화
5. **CORS 정책 강화**: `allow_methods=["*"]` → 허용 메서드 명시적 열거
6. **비동기 병렬 API 호출**: `fetchActiveAssetsForUser()` Promise.all 병렬화

---

## 리뷰어별 원본 발견 사항

<details>
<summary>Security Review (발견: 6건 + 2개 결합 시나리오)</summary>

**[SEC-1]** 반납 API 소유권 검사 누락 — Critical / Blocking
**[SEC-2]** dangerouslySetInnerHTML XSS — High / Blocking
**[SEC-3]** handleError userId 평문 로깅 — Medium / Non-blocking
**[SEC-4]** localStorage userId 평문 저장 — Medium / Non-blocking
**[SEC-5]** 비즈니스 로직이 Router에 — Medium / Non-blocking
**[SEC-6]** availability/all 인증 없음 — Low / Non-blocking

결합:
- [COMBO-SEC-1] XSS → userId 탈취 → 강제 반납 (Critical)
- [COMBO-SEC-2] 소유권 누락 + 순차 ID → 대량 강제 반납 (Critical)

비계획: 7일 버튼 3일 호출 / reload() 에러 핸들링 부재 / CORS allow_methods=["*"]

</details>

<details>
<summary>Performance Review (발견: 6건)</summary>

**[PERF-1]** N+1 쿼리 /assets/availability/all — Critical / Blocking
**[PERF-2]** 인덱스 없는 (asset_id, returned_at) — High / Blocking
**[PERF-3]** 프론트엔드 N+1 HTTP 요청 reload() — High / Non-blocking
**[PERF-4]** useEffect deps 누락 필터 불일치 — Medium / Non-blocking
**[PERF-5]** fetchActiveAssetsForUser() 직렬 호출 — Medium / Non-blocking
**[PERF-6]** key={index} — Low / Non-blocking

</details>

<details>
<summary>Test Coverage Review (발견: 7건 + 3개 명세 모호성)</summary>

**[TEST-1]** return_rental 소유권 미검사 (코드 + 테스트 동시 누락) — Critical / Blocking
**[TEST-2]** asset.status 검증 누락 + maintenance 버그 — Critical / Blocking
**[TEST-3]** 이미 반납된 대여 재반납 테스트 부재 — High / Non-blocking
**[TEST-4]** extra_days 음수/0 입력 — Critical / Blocking
**[TEST-5]** due_at 날짜 정확성 검증 누락 — High / Non-blocking
**[TEST-6]** 7일 버튼 3일 호출 — Critical / Blocking
**[TEST-7]** MyRentals 필터 동작 불가 — High / Blocking

모호성: AMB-1(MAX_EXTEND_DAYS 의미) / AMB-2(extra_days 최솟값) / AMB-3(is_available_now 판단 기준)
환경 가정: ENV-1(BASE URL 하드코딩) / ENV-2(인증 헤더 누락)
비계획: dangerouslySetInnerHTML XSS / Router에 비즈니스 로직 / conftest fixture 부재

</details>

<details>
<summary>Architecture Review (발견: 7건 + 2개 결합 시나리오)</summary>

**[ARCH-1]** Router에서 ORM 직접 접근 — Critical / Blocking (§1 위반)
**[ARCH-2]** maintenance 상태 덮어쓰기 버그 — Critical / Blocking (§2 위반)
**[ARCH-3]** return_rental 권한 검사 비대칭 — High / Blocking (§4 위반)
**[ARCH-4]** 트랜잭션 경계가 Router에 — High / Non-blocking (§5 위반, ARCH-1 해결 시 자동 해소)
**[ARCH-5]** MAX_EXTEND_DAYS Router 파일에 정의 — Medium / Non-blocking (§1 위반)
**[ARCH-6]** api/client.ts 우회 및 authHeaders() 미사용 — High / Non-blocking (§1 위반)
**[ARCH-7]** dangerouslySetInnerHTML — Medium / Non-blocking (§1 파생)

결합:
- [COMBO-ARCH-1] ARCH-1+ARCH-3: 레이어 붕괴 × 권한 누락 → 미인증 반납
- [COMBO-ARCH-2] ARCH-2+ARCH-4: 이중 상태 × Router 커밋 → 부분 커밋 데이터 오염

비계획: 7일 버튼 3일 호출 / 라우터 경로 충돌 가능성

</details>

---

*이 리포트는 5-에이전트 합의 기반 리뷰 시스템에 의해 자동 생성되었습니다. 발견자 속성은 각 리뷰어의 독립적 분석 결과를 기준으로 합니다.*
