<!-- Language: ko -->

# Greenhub — 트러블슈팅 이력

> 과거에 실제로 발생한 문제에서 **재사용 가능한 진단 패턴**만 남긴다. 아래 해결 당시의 환경·URL·계정·Rules 상태를 현재값으로 간주하지 않는다.
>
> 현재 상태가 필요한 경우 `docs/memory.md`, 현재 코드·설정·테스트, provider 직접 재조회 순으로 확인한다. 비밀값·사용자 ID·전체 전화번호·실계정 이메일 등 식별자는 이 문서에 기록하지 않는다.

## 공통 원칙

1. 과거 incident의 해결 명령을 현재 production에 그대로 재실행하지 않는다.
2. URL·환경 변수·DNS·OAuth 설정은 `docs/URLS.md`의 canonical 기준과 provider 현재 상태를 함께 확인한다.
3. Firestore 운영 문서를 troubleshooting 목적으로 임의 수정하지 않는다.
4. 401/403/404/CORS 오류는 UI 증상만 보고 추측하지 말고 request origin, JWT role/sub, API route, 데이터 소유권, provider 상태를 각각 분리한다.
5. 오래된 테스트 계정이나 seed 식별자를 운영 정본처럼 사용하지 않는다.

---

## [2026-04-04] Firestore `get` vs `list` 권한 구분

### 당시 증상

단일 문서 조회는 되지만 컬렉션 query/onSnapshot에서 `Missing or insufficient permissions`가 발생했다.

### 재사용 가능한 원인 패턴

Firestore Rules에서 `get`과 `list`는 별도 권한이다.

- `getDoc(doc(...))` → 단일 `get`
- `getDocs(query(...))`, query 기반 `onSnapshot` → `list`

### 현재 체크포인트

- 새 collection의 client 직접 접근 여부를 먼저 확인한다.
- consumer/seller/driver가 직접 Firestore를 쓰는 영역과 API를 통하는 영역을 혼동하지 않는다.
- Rules 변경은 해당 collection의 현재 spec·코드·Rules test를 함께 확인한다.
- 과거의 `allow read: if true` 해결책을 현재 Rules에 복사하지 않는다.

---

## [2026-04-04] 목록 API 응답 shape 오해

### 당시 증상

HTTP 200인데 목록 UI가 비어 있었다.

### 원인 패턴

클라이언트가 API 응답을 배열로 가정했지만 endpoint는 `{ items, total }` 형태를 반환했다.

### 현재 체크포인트

- endpoint별 현재 DTO와 service/controller 구현을 확인한다.
- “모든 목록 API가 같은 shape”라고 가정하지 않는다.
- frontend에서 임의의 `Array.isArray()` fallback을 늘리기보다 공개 API 계약을 타입으로 고정한다.

---

## [2026-04-04] `NEXTAUTH_URL` / OAuth callback URL 불일치

### 당시 증상

로그인 404, callback 실패, redirect loop가 발생했다.

### 원인 패턴

배포 도메인과 인증 callback 기준 URL이 달랐다.

### 현재 체크포인트

- production canonical URL은 `docs/URLS.md`를 확인한다.
- 실제 Vercel `NEXTAUTH_URL`/`AUTH_URL`은 변경 직전에 provider에서 재조회한다.
- 둘을 서로 다른 값으로 두지 않는다.
- URL 변경 시 Vercel domain, Railway CORS, Kakao Redirect URI를 함께 점검한다.
- 문서의 과거 snapshot만 보고 production 환경 변수를 덮어쓰지 않는다.

---

## [2026-04-04] Railway `CORS_ORIGIN` 누락

### 당시 증상

특정 frontend에서만 API 호출이 CORS로 차단됐다.

### 원인 패턴

요청 origin이 API 허용 목록에 없었다.

### 현재 체크포인트

- production canonical origins와 제한된 Preview origin 정책을 구분한다.
- `apps/api/src/main.ts`와 `apps/api/src/common/cors-origin*`의 현재 로직을 확인한다.
- 실제 Railway 변수는 provider에서 재조회한다.
- 오래된 `*.vercel.app` alias 목록을 현재 production CORS 값으로 복사하지 않는다.

---

## [2026-04-04] `@Roles`와 서비스 내부 role 정책 불일치

### 당시 증상

인증은 성공했지만 seller/admin 기능에서 403이 발생했다.

### 원인 패턴

Controller의 `@Roles`와 서비스/FSM의 실제 role 허용 규칙이 서로 달랐다.

### 현재 체크포인트

- 403이면 controller guard만 보지 말고 service의 소유권/FSM 검사까지 추적한다.
- `admin`이 모든 seller 기능을 자동 상속한다고 가정하지 않는다. endpoint별 현재 정책을 확인한다.
- 공개 역할 계약을 바꾸는 경우 관련 API spec·shared type·E2E를 함께 갱신한다.

---

## [2026-04-04] Store `ownerId`와 로그인 subject 불일치

### 당시 증상

유효한 seller 로그인인데 store 소유권 검사에서 403이 발생했다.

### 원인 패턴

seed/store 문서의 `ownerId`와 현재 인증 사용자의 JWT `sub`가 달랐다.

### 현재 체크포인트

- store ownership 오류는 JWT `sub`, store `ownerId`, seed namespace를 값 비공개 방식으로 비교한다.
- 특정 실사용자 UUID나 이메일을 문서 정본으로 기록하지 않는다.
- 운영 데이터 수정은 승인된 migration/관리 절차로 수행한다.
- troubleshooting 목적으로 Admin SDK에서 운영 `ownerId`를 직접 덮어쓰지 않는다.

---

## [2026-04-04] JWT/NextAuth 세션 구조 변경 후 구 세션 잔존

### 당시 증상

refresh token 필드를 추가한 새 코드 배포 뒤에도 기존 세션에서 갱신 로직이 동작하지 않았다.

### 원인 패턴

이미 발급된 session cookie/token에는 새 필드가 없었다.

### 현재 체크포인트

- JWT/session payload 구조 변경 시 backward compatibility를 검토한다.
- 필요하면 명시적 재로그인, session versioning, 만료 전략 중 하나를 설계한다.
- `JWT_REFRESH_SECRET` 등 실제 자격 증명 존재 여부는 문서가 아니라 대상 환경에서 확인한다.

---

## [2026-04-04] NextAuth v5 / Kakao Preview callback 문제

### 당시 증상

Preview에서 Kakao 로그인 완료 단계가 실패하거나 PKCE/session cookie가 일치하지 않았다.

### 원인 패턴

로그인 시작 origin과 설정된 callback 기준이 일관되지 않아 OAuth/PKCE cookie 흐름이 깨졌다.

### 현재 체크포인트

- 현재 Preview 인증 정책은 `docs/specs/ops/preview-auth-url-policy.md`를 따른다.
- 커밋별 Preview URL을 Kakao Redirect URI에 무제한 추가하지 않는다.
- production OAuth 완료 smoke와 Preview authorize 진입 smoke를 구분한다.
- “Preview는 절대 로그인 불가” 같은 과거 결론을 일반화하지 않고 현재 정책을 확인한다.

---

## [2026-04-04] pnpm lockfile/specifier 불일치

### 당시 증상

`pnpm install`에서 frozen lockfile/specifier 관련 오류가 발생했다.

### 원인 패턴

`package.json`과 `pnpm-lock.yaml`의 dependency specifier가 맞지 않았다.

### 현재 체크포인트

- 저장소 `packageManager` 버전과 CI의 pnpm 버전을 먼저 확인한다.
- 임의로 `--no-frozen-lockfile`을 production CI 해결책으로 사용하지 않는다.
- dependency 변경 Task에서만 lockfile을 의도적으로 재생성하고 diff를 검토한다.

---

## [2026-04-04] 주문 FSM role fallback 오류

### 당시 증상

정상 seller/admin 동작이 consumer 전이 규칙으로 판정되어 403이 발생했다.

### 원인 패턴

Controller에서 알고 있는 인증 role과 service/FSM에 전달되는 role source가 달랐다.

### 현재 체크포인트

- 상태 전이 오류는 현재 `orders` spec과 FSM helper를 함께 확인한다.
- JWT role, Firestore role, default fallback 중 어떤 값이 실제 판정에 쓰이는지 추적한다.
- 과거 상태 집합을 현재 회차 직배송 상태 전이에 그대로 적용하지 않는다.

---

## [2026-04-04] Order denormalized snapshot 필드 누락

### 당시 증상

Driver 주문 화면에서 상품명·배송지·구매자 정보가 비어 보였다.

### 원인 패턴

Driver가 읽는 order snapshot 필드를 주문 생성 시 저장하지 않았다.

### 현재 체크포인트

- 주문 생성/최종화 시 소비자·seller·driver가 필요로 하는 snapshot 필드를 현재 `orders` spec으로 확인한다.
- 원본 product/user 문서를 나중에 재조회하면 과거 주문 의미가 바뀔 수 있는 값은 denormalization 필요성을 검토한다.
- 개인정보 필드를 추가할 때 retention·노출 범위를 함께 검토한다.

---

## [2026-04-04] 사용자 표시명 placeholder 노출

### 당시 증상

마이페이지에 placeholder 이름이 그대로 보였다.

### 원인 패턴

테스트/seed placeholder를 인증 session이 실제 display name으로 신뢰했다.

### 현재 체크포인트

- 실제 사용자 표시명, email local-part, user ID의 fallback 우선순위를 명시한다.
- 내부 ID를 사용자 표시명 fallback으로 노출하지 않는다.
- seed 데이터의 placeholder가 production UI로 새어나오지 않도록 E2E fixture와 실제 onboarding을 분리한다.

---

## 새 troubleshooting 항목 작성 규칙

새 incident를 추가할 때는 다음 형식을 사용한다.

```text
## [YYYY-MM-DD] 짧은 제목
### 증상
### 확인한 원인
### 해결 당시 조치
### 현재 재사용 가능한 체크포인트
```

기록하지 않는 것:

- 비밀값
- 전체 전화번호·주소
- 실사용자 이메일
- 사용자/스토어 UUID 원문
- 일회성 provider token
- “현재 production 값”이라고 보장할 수 없는 과거 환경 변수 값

현재 상태가 변하면 `docs/memory.md`를 갱신하고, 이 문서는 과거 incident의 재사용 가능한 진단 패턴만 유지한다.
