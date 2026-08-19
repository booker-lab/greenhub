<!-- Language: ko -->

# 🗺️ Project Blueprint: consumer 법적 고지와 카카오 재심사

## 문서 메타

- **SSOT Check**: `docs/specs/legal/consumer-legal-documents.md`, `docs/specs/ops/kakao-business-channel-proof.md`, `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Priority**: 0
- **Labels**: consumer, privacy, terms, compliance, kakao-review
- **Architectural Goal**: 실제 consumer 개인정보 흐름과 현재 운영 상태를 기준으로 공개 법적 고지를 만들고 카카오 사업자채널 연관성 검증을 다시 요청한다.
- **작성일**: 2026-08-19
- **상태**: 계획 작성 완료·구현 승인 대기
- **실행 승인 문구**: `PLAN 전체 실행`
- **계획 검증**: 저장소 `Justfile`에 `plan-preread`·`plan-lint`가 없어 이식 규칙 수동 검증을 적용한다.

## 📋 업무 요약

### 개요

`https://greenlove.co.kr/privacy`와 `https://greenlove.co.kr/terms`를 로그인 없이 열리는 정적 공개 문서로 만들고, 홈의 기존 사업자 푸터에서 두 문서로 이동하게 한다. 문안은 템플릿이나 향후 희망 기능이 아니라 현재 consumer·API 코드, 프로덕션 인프라, 사용자 확인 사실, 2026년 8월 19일 기준 공식 지침을 대조해 작성한다. 구현·검증·consumer 프로덕션 배포가 끝난 뒤에도 카카오 재심사는 자동 제출하지 않으며 사용자의 별도 명시적 승인을 기다린다.

### 사용자 확인 사실

- 현재 상용 결제대행은 운영하지 않는다.
- 결제 도입 순서는 카카오페이·네이버페이 우선, 카드 결제 후속이다.
- 배송 도입 순서는 자체 회차 직배송 우선, 택배 후속이다.
- 별도 마케팅 수신 동의는 운영하지 않는다.
- 교환·반품 비용과 자체 배송 운영 기준은 확정되지 않았다.
- 2026년 8월 19일 카카오 4차 반려 사유는 홈페이지에서 개인정보처리방침과 이용약관을 확인할 수 없어 채널과 사업자의 연관성을 검증할 수 없다는 것이었다.
- 이번 반려 답변에는 채널 고객센터 전화번호 불일치가 언급되지 않았다.

### 완료 관찰

- 비로그인 사용자가 `/privacy`와 `/terms`를 각각 HTTP 200으로 열 수 있다.
- 홈 푸터에서 `개인정보처리방침`과 `이용약관` 링크를 키보드·터치로 사용할 수 있다.
- 개인정보처리방침이 카카오 로그인, 회원정보, 주소록, 주문 시도, 결제 요청 경로, 알림, 필수 쿠키, 브라우저 저장소, 로그, 수탁자, 국외 처리, 권리 행사를 실제 구현 범위대로 설명한다.
- 이용약관이 그린러브와 디어 오키드의 관계, 현재 제공 서비스, 회원 책임, 게시·변경, 분쟁 절차를 설명한다.
- 미운영 결제수단, 미도입 택배, 미확정 반품비, 미확정 직배송 기준, 마케팅 기능을 현재 제공 기능처럼 쓰지 않는다.
- 모바일 375×812와 데스크톱에서 본문을 읽을 수 있고 고정 하단 내비게이션이 마지막 문단과 링크를 가리지 않는다.
- consumer 프로덕션만 새 배포 대상으로 삼고 seller·driver·Railway API의 비대상 배포 여부를 확인한다.
- 운영 문서와 카카오 재심사 보고서에 배포 SHA, 운영 URL, 검증 결과, 접수 증적을 연결한다.

### 이번 계획에서 하지 않는 것

- consumer 주문·결제·배송 기능 활성화
- PortOne·카카오페이·네이버페이 계약 체결 또는 결제수단 설정 변경
- 교환·반품 비용이나 자체 배송 기준의 임의 결정
- 택배 기능 도입
- 마케팅 수신 동의 기능 도입
- 회원 탈퇴 API, 카카오 연결 해제 웹훅, 자동 보존기간 만료 파기 작업 구현
- seller·driver·API 기능 변경
- ALIGO 설정 변경
- 카카오 채널 고객센터 번호, 이메일, DNS, 공개 소식 변경
- 공정거래위원회 표준약관 마크 사용
- 변호사 법률의견을 받은 것으로 표현
- 중단된 회차 직배송 계획의 Task를 소급 수정하거나 재개

## 🎯 Origin Intent

- **출처**: 사용자가 제공한 2026년 8월 19일 작업 인계와 카카오 4차 반려 답변
- **원래 목적**: 심사자가 공개 홈페이지에서 그린러브의 운영 사업자와 필수 법적 고지를 직접 대조하게 한다.
- **보존해야 할 의도**: 법적 문서가 심사용 장식물이 아니라 실제 서비스의 개인정보 처리와 현재 운영 상태를 정확히 설명하게 한다.
- **완료 관찰**: 홈·개인정보처리방침·이용약관이 하나의 공개 증거 사슬을 이루고, 운영 검증 후 사용자가 승인한 경우에만 카카오 재심사가 접수된다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 처리 원칙 |
| :--- | :--- | :--- | :--- |
| `/privacy`와 `/terms`가 현재 운영에서 404임 | 운영 HTTP 점검 | 2.2, 2.3, 4.3 | 공개 Server Component 페이지로 만들고 프로덕션에서 200을 재검증 |
| 카카오 반려 사유를 전화번호 문제로 잘못 확대할 수 있음 | 4차 반려 답변 | 1.2, 4.4 | 확인된 법적 고지 누락만 재심사 사유로 기록 |
| 사용자는 상용 PG 미운영을 확인했지만 consumer 코드와 프로덕션 환경에는 PortOne 경로가 남아 있음 | 사용자 확인·코드·환경 점검 | 1.1, Release Gate | 환경변수 존재를 계약·운영 증거로 간주하지 않으며 공개 결제 성공 여부를 임의 주문으로 시험하지 않음 |
| 결제 호출 전에 주문 개인정보가 API에 저장될 수 있음 | checkout·orders 코드 | 1.1, 2.2 | 결제 성공 여부와 분리해 주문 시도 단계의 수집 항목을 개인정보처리방침에 반영 |
| 향후 카카오페이·네이버페이를 현재 결제수단으로 오인할 수 있음 | 사용자 확인 | 1.1, 2.3 | 현재 약관에서 활성 결제수단으로 열거하지 않음 |
| 택배·자체 회차 배송 조건이 확정되지 않음 | 사용자 확인 | 1.1, 2.3, 범위 밖 | 현재 운영 조건으로 만들지 않고 상거래 개시 전 별도 확정이 필요함을 기록 |
| 상품 화면의 포괄적 `취소/환불 불가` 문구가 법정 철회권과 충돌할 수 있음 | 코드 점검·전자상거래법 제17조 | 1.1, 2.3, 범위 밖 | 약관에 복제하지 않고 별도 판매 출시 차단 항목으로 기록 |
| 반품비가 미확정임 | 사용자 확인 | 1.1, 2.3, 범위 밖 | 금액을 추정하지 않고 판매 개시 전 청약 화면 고지 필요성을 기록 |
| 통신판매업 신고번호가 공개 정본에 없음 | 공개 정본 | 1.2, 범위 밖 | 번호를 추정하지 않으며 실제 청약 수령 전 별도 확인 대상으로 유지 |
| 카카오 로그인 이용자의 탈퇴·연결 해제 자동 처리 경로가 없음 | auth 코드·카카오 공식 문서 | 1.1, 범위 밖 | 현재 권리 행사 접수 채널을 정확히 고지하고 자동화 부재를 후속 API 위험으로 남김 |
| Firestore 사용자·주문·결제·알림·감사 로그에 만료 파기 작업이 없음 | API 코드 | 1.1, 범위 밖 | 법정·업무 보존기간과 수동 처리 책임을 문서화하고 자동화 완료를 가장하지 않음 |
| API가 미국 `us-west2`에서 동작함 | Railway 운영 상태 | 1.1, 2.2 | 국외 처리 국가·시점·방법·목적·기간·거부 방법을 실제 계약 기준으로 고지 |
| Firestore는 서울 `asia-northeast3`에 있음 | `gcloud` 운영 조회 | 1.1, 2.2 | 국내 저장과 미국 API 처리를 구분 |
| Vercel DPA 적용 범위가 요금제에 따라 달라질 수 있음 | Vercel 공식 DPA | 1.1, Release Gate | 계정에 적용되는 계약을 확인하지 못하면 수탁자 문안을 확정하지 않음 |
| 수탁자·재수탁자 목록이 변할 수 있음 | 개인정보위 2026 지침 | 1.1, 1.2 | 실제 업체 조회 경로와 문서 개정 절차를 운영 정본에 둠 |
| 배송 담당자가 내부 인력인지 외부 수탁자인지 확정되지 않음 | driver 데이터 접근 점검 | 1.1, 범위 밖 | 현재 판매·배송을 가정해 제3자 제공 문구를 만들지 않음 |
| 개인정보 제3자 제공과 처리위탁을 혼동할 수 있음 | 코드·공식 지침 | 1.1, 2.2 | 법적 역할, 수령 목적, 통제 관계를 확인한 뒤 각각 분리 |
| 카트와 알림 읽음 상태가 브라우저에 저장됨 | consumer 코드 | 1.1, 2.2 | 서버 전송 정보와 기기 내 저장 정보를 구분하고 삭제 방법을 안내 |
| Auth.js 필수 쿠키가 있으나 맞춤형 광고 도구는 없음 | consumer 코드 | 1.1, 2.2 | 필수 인증 쿠키만 설명하고 광고·분석 쿠키를 운영한다고 쓰지 않음 |
| 14세 미만 연령 확인 절차가 없음 | consumer 코드 | 1.1, 범위 밖 | 아동 미수집을 단정하지 않고 연령 정책 부재를 후속 출시 위험으로 남김 |
| 하단 고정 내비게이션이 긴 법적 문서의 마지막 부분을 가릴 수 있음 | root layout | 2.1, 3.3, 4.3 | 문서 공통 셸에 충분한 하단 여백을 둠 |
| 법적 문서가 홈 전용 푸터에만 연결됨 | 현재 페이지 구조 | 2.4, 2.5 | 홈 푸터 접근을 보장하고 두 문서 사이 상호 이동 링크를 별도로 둠 |
| 법적 문서가 로그인 리디렉트에 포함될 수 있음 | `proxy.ts` | 2.2, 2.3, 4.3 | 보호 경로 목록에 넣지 않고 깨끗한 비로그인 환경에서 확인 |
| 약관 개정 시 과거 문서를 찾을 수 없을 수 있음 | 운영 지속성 | 1.1, 1.2 | 시행일·개정일·이전 버전 보관 절차를 정본에 정의 |
| 법적 고지 배포가 seller·driver·API 재배포를 유발할 수 있음 | 기존 배포 이력 | 4.2 | 비대상 서비스는 상태만 확인하고 임의 재배포·롤백 금지 |
| 프로덕션 공개만으로 카카오 재심사를 자동 제출할 수 있음 | 외부 상태 변경 | External Action Gate, 4.4 | 별도 사용자 승인 전 접수 금지 |

## 🔍 Diagnosis & Findings

### 현재 공개 상태

- 2026년 8월 19일 원시 HTTP 확인 결과 `https://greenlove.co.kr/`은 200, `/privacy`와 `/terms`는 각각 404다.
- `apps/consumer/src/proxy.ts`는 마이페이지·장바구니·체크아웃·주문만 보호한다. 새 법적 고지 경로는 보호 목록을 바꾸지 않아도 공개 경로가 된다.
- `apps/consumer/src/app/page.tsx`는 홈에서만 `BusinessInfoFooter`를 렌더링한다. 기존 푸터는 사업자 정본을 표시하지만 법적 고지 링크가 없다.
- `apps/consumer/src/app/layout.tsx`는 모든 화면에 고정 하단 내비게이션을 렌더링한다. 긴 문서에는 마지막 콘텐츠가 가리지 않도록 별도 하단 여백이 필요하다.
- 설치된 Next.js 16.2.5 문서에 따르면 `page.tsx`는 파일 시스템 공개 경로를 만들고 페이지·레이아웃은 기본적으로 Server Component다. 이 문서는 브라우저 상태가 필요 없으므로 Client Component로 만들 이유가 없다.

### 실제 개인정보 흐름

| 단계 | 실제 항목 | 처리 위치·전달 경로 | 현재 코드 근거 |
| :--- | :--- | :--- | :--- |
| 카카오 로그인 | 카카오 식별자, 이름, 이메일 | Kakao → consumer Auth.js → Railway API → Firestore | `apps/consumer/src/auth.ts`, `apps/api/src/auth/auth.service.ts` |
| 인증 유지 | 세션 쿠키, API 접근 토큰, 갱신 토큰 | 브라우저·Vercel 함수·Railway API·Firestore `refreshTokens` | 같은 auth 파일 |
| 회원 프로필 | 식별자, 이메일, 이름, 선택 전화번호, 역할, 제공자, 주소록, FCM 토큰 | Firestore `users` | 공유 `UserProfile`, auth 서비스 |
| 주소록 | 주소명, 우편번호, 기본주소, 상세주소 | consumer → Railway API → Firestore 사용자 문서 | 마이페이지 주소 화면·users 서비스 |
| 장바구니 | 상품·가격·수량·판매유형·배송방식·매장·희망일 | 기기 `localStorage`의 `greenhub_cart` | `apps/consumer/src/hooks/useCart.ts` |
| 체크아웃 전달 | 장바구니 사본 | 기기 `sessionStorage`의 `checkout_cart` | cart·checkout 페이지 |
| 주문 시도 | 구매자명·전화번호·주소·우편번호·상품·매장·가격·배송방식·희망일 | Railway API → Firestore `orders` | checkout·orders create 서비스 |
| 결제 요청 | 주문·사용자·금액·수단·PortOne 식별자·상태·환불 정보 | consumer SDK·Railway API·Firestore `payments` | `usePayment`, payments 서비스 |
| 주문 이행 | 구매자명·배송지, 조건부 전화번호 | 판매자·직배송 담당 화면 | seller 주문 상세·driver 주문 화면 |
| 알림 | 사용자·주문·채널·메시지 변수·전화번호·상태·오류 | Railway API → Firestore `notifications`, 조건부 ALIGO | notifications 서비스 |
| 알림 읽음 | 알림 식별자 집합 | 기기 `localStorage`의 `gh_read_notifications` | `useNotifications.ts` |
| 보안·감사 | 사용자 식별자, IP, 작업, 상세, 시각 | Railway API → Firestore `auditLogs`, 런타임 로그 | audit·auth·logger 코드 |

### 운영 인프라 대조

- consumer 프로덕션 환경에는 PortOne store·카카오페이 채널 이름의 설정이 있고 API 프로덕션에는 PortOne 서버 키 이름이 있다. 이는 기술 경로의 존재만 증명하며 상용 계약·가맹점 활성화를 증명하지 않는다.
- consumer 프로덕션에는 네이버페이 채널 설정 이름이 없고 API 프로덕션에는 ALIGO 설정 이름이 없다.
- Firestore 기본 데이터베이스 위치는 `asia-northeast3`이며 공식 Firebase 위치표상 서울이다.
- Railway 프로덕션 API는 `us-west2` 한 개 복제본에서 동작하며 공식 Railway 위치표상 미국 캘리포니아다.
- Vercel 공식 DPA는 주 처리 시설이 미국에 있고 전 세계 재수탁자 처리 가능성이 있음을 밝힌다. 현재 계정 요금제에 적용되는 계약 범위는 문안 확정 전에 계정에서 다시 확인해야 한다.
- Vercel·Railway의 환경변수 값, API 키, 토큰은 조사 결과나 법적 문서에 기록하지 않는다.

### 보존·삭제 간극

- API의 `users`, `orders`, `payments`, `notifications`, `auditLogs`에는 현재 일반 만료 파기 작업이 없다.
- API 갱신 토큰은 기본 30일이고 로그인 시 최신 토큰으로 회전하며 로그아웃 시 삭제한다.
- consumer에는 회원 탈퇴 화면·탈퇴 API가 없고 카카오 연결 해제 웹훅도 없다.
- 개인정보처리방침은 존재하지 않는 자동 삭제 기능을 약속하지 않는다. 다만 법정 보존기간과 고객센터를 통한 권리 행사 절차는 운영자가 실제 수행할 책임으로 명시한다.
- 자동 파기, 탈퇴, 카카오 연결 해제는 이번 consumer-only 계획의 범위를 넘으므로 별도 API 승인 작업으로 기록한다. 이 간극을 해소하기 전에는 상거래 출시 완료를 선언하지 않는다.

### 공식 근거

- 개인정보보호위원회의 [2026년 4월 개인정보 처리방침 작성지침](https://m.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=12018)은 실제 처리 현황의 정확성, 구체적 보유기간, 수탁자, 국외이전, 권리 행사, 접근성을 요구한다.
- 개인정보 보호법 시행령 [제31조](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900079801)는 처리 항목, 국외이전, 안전조치 등을 처리방침에 포함하고 홈페이지에 계속 공개하도록 정한다.
- 전자상거래법 [제6조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031806293)와 시행령 [제6조](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0006&lsiSeq=269055&urlMode=lsScJoRltInfoR)는 표시·광고 6개월, 계약·철회 5년, 결제·공급 5년, 불만·분쟁 3년 보존 기준을 둔다.
- 전자상거래법 [제13조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029561449)는 계약 전 거래조건과 청약철회 방법을 고지하도록 정한다.
- 전자상거래법 [제17조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029561405)는 일반적인 7일 철회권과 예외의 사전 표시 조건을 둔다. 확정되지 않은 비용이나 포괄적 환불 불가 문구로 대체할 수 없다.
- 공정거래위원회 [전자상거래 표준약관 제10023호](https://www.ftc.go.kr/www/selectBbsNttView.do?bordCd=201&key=202&nttSn=11139&pageIndex=1&pageUnit=10&searchCnd=all&searchKrwd=%EC%A0%84%EC%9E%90%EC%83%81%EA%B1%B0%EB%9E%98+%ED%91%9C%EC%A4%80)는 참고 기준으로만 사용한다. 현재 서비스에 맞춰 변경한 문서에는 표준약관 마크를 붙이지 않는다.
- 카카오 공식 로그인 문서는 계정 삭제 시 카카오 식별자를 포함한 개인정보를 복구 불가능하게 파기하고 연결 해제 웹훅으로 상태를 확인하도록 권고한다.
- [Vercel DPA](https://vercel.com/legal/dpa), [Railway DPA](https://railway.com/legal/dpa), [Railway 리전 문서](https://docs.railway.com/deployments/regions), [Firebase 위치 문서](https://firebase.google.com/docs/firestore/locations)는 수탁자 법인·처리 위치·재수탁자 확인의 1차 자료로 사용한다.

## 법적 문안 계약

### 개인정보처리방침 계약

`docs/specs/legal/consumer-legal-documents.md`는 구현 전에 다음 내용을 현재형·해당 시 구분으로 고정한다.

1. 처리자 `디어 오키드`와 서비스명 `그린러브`의 관계
2. 개인정보 처리 목적, 법적 근거, 수집 항목, 수집 방법
3. 카카오 로그인에서 제공받는 항목과 카카오 식별자 처리
4. 회원·주소록·주문 시도·결제 요청·알림·감사 로그의 항목
5. 회원정보, 거래기록, 불만·분쟁, 인증정보, 로그의 구체적 보유기간
6. 법정 보관 데이터의 분리 보관 원칙과 전자적 파기 방법
7. 제3자 제공 해당 여부
8. 처리위탁 업체의 정확한 법인명, 업무, 재수탁자 조회 경로
9. 국외 처리의 법적 근거, 국가, 시점·방법, 항목, 수령자 연락처, 목적, 기간, 거부 방법·효과
10. 필수 인증 쿠키와 `greenhub_cart`, `checkout_cart`, `gh_read_notifications`의 기기 저장 목적·삭제 방법
11. 맞춤형 광고·별도 마케팅 동의·가명정보·민감정보·자동화된 결정의 현재 미운영 사실
12. 열람·정정·삭제·처리정지·동의철회 요청 방법과 본인 확인 절차
13. 고객센터를 이용한 회원 삭제 요청 절차와 카카오 연결 해제 한계
14. 기술적·관리적 안전조치
15. 개인정보 보호 담당부서, 전화번호, 이메일
16. 침해 신고·분쟁조정 구제기관 안내
17. 시행일, 변경 고지, 이전 버전 보관 방식

확인되지 않은 배송 인력 관계, 미운영 PG, 향후 결제 브랜드는 제3자·수탁자 현재 목록에 넣지 않는다. 반대로 실제 프로덕션 요청이 Vercel·Railway·Firebase를 거치는 사실은 누락하지 않는다.

### 이용약관 계약

`docs/specs/legal/consumer-legal-documents.md`는 이용약관에 다음 경계를 고정한다.

1. 목적, 용어, 그린러브 운영자 `디어 오키드`
2. 약관 게시, 효력, 개정, 개정 전 고지
3. 현재 제공하는 상품 정보 탐색, 카카오 로그인, 회원 기능, 장바구니, 알림의 범위
4. 회원 신청, 계정 관리, 이용 제한, 탈퇴 요청 채널
5. 사용자의 금지행위와 콘텐츠·서비스 권리
6. 서비스 변경·중단·공지 원칙
7. 개인정보 보호 문서와의 연결
8. 책임 제한이 고의·중과실이나 법정 소비자 권리를 배제하지 않는다는 원칙
9. 민원 처리, 준거법, 관할
10. 시행일과 이전 버전 보관 방식

현재 상용 결제가 운영되지 않는다는 사용자 확인을 기준으로 PG 브랜드, 카드, 택배, 자체 회차 배송 세부 조건, 반품비를 현재 제공 조건으로 쓰지 않는다. 향후 판매 개시 전 상품·청약 화면에 가격, 공급 방법·시기, 철회 방법, 비용, 제한 사유를 확정해 고지하고 약관·개인정보처리방침을 먼저 개정해야 한다는 출시 조건만 기록한다. `취소 불가`, `환불 불가`, `생물이라 반품 불가` 같은 포괄 문구는 사용하지 않는다.

## 🏗️ Architectural Deepening

- **정본 경계**: 법적 문안 근거는 `docs/specs/legal/consumer-legal-documents.md`에, 공개 사업자·카카오 증거는 `docs/specs/ops/kakao-business-channel-proof.md`에 둔다.
- **현재·미래 경계**: 현재 작동하는 처리와 향후 출시 계획을 같은 시제로 섞지 않는다. 기능 활성화 전 정책 선개정 규칙을 정본에 둔다.
- **페이지 경계**: `/privacy`와 `/terms`는 정적 Server Component로 만든다. 인증·브라우저 상태·클라이언트 자바스크립트를 요구하지 않는다.
- **푸터 경계**: `BusinessInfoFooter`는 홈 전용으로 유지하고 법적 링크만 추가한다. root layout의 공통 푸터로 옮기지 않으며 두 법적 문서는 홈·상대 문서 링크를 자체 제공한다.
- **공통 셸 경계**: `LegalDocumentPage`가 제목, 시행일, 본문 폭, 목차형 탐색, 홈·상호 문서 링크, 하단 안전 여백을 담당한다.
- **콘텐츠 경계**: 개인정보처리방침과 이용약관의 법적 내용은 각 `page.tsx`가 명시적으로 렌더링한다. 사업자 값은 `PUBLIC_BUSINESS_INFO`를 참조해 중복 정본을 만들지 않는다.
- **메타데이터 경계**: 각 페이지가 독립적인 `Metadata` 제목·설명을 제공해 브라우저와 심사자가 문서 성격을 식별하게 한다.
- **접근성 경계**: 문서당 `h1` 하나, 순차적인 `h2`, 실제 목록·표, 충분한 링크 터치 영역, 긴 이메일·주소 줄바꿈을 보장한다.
- **데이터 분류 경계**: 제3자 제공, 처리위탁, 국외 처리를 별도 표로 나눈다. 계약 관계를 확인하지 못한 업체는 임의 분류하지 않는다.
- **보존 경계**: 법정 보존기간과 현행 자동 파기 부재를 동시에 기록한다. 수동 처리 책임을 운영 정본에 두되 기술 부채 완료로 표시하지 않는다.
- **검증 경계**: 소스 계약 테스트는 필수 제목·금지 문구·공개 링크를 고정하고 Playwright 검증기는 명시된 기준 URL의 공개 접근·모바일 레이아웃·상호 이동을 실제 화면에서 확인한다.
- **배포 경계**: consumer 파일과 문서만 변경한다. seller·driver·Railway API는 비대상 상태를 관찰할 뿐 조작하지 않는다.
- **외부 변경 경계**: 프로덕션 공개와 카카오 재심사 접수를 분리한다. 재심사는 별도 사용자 승인 뒤에만 수행한다.

## Agent Completion Contract

각 Task는 지정한 파일 하나만 변경한다. Verify가 종료 코드 0을 반환한 뒤 Conclusion을 실측 결과로 갱신한다. 전체 실행 요청을 받으면 Task 순서를 고정하고 검증 실패, 확인되지 않은 수탁자 계약, 예상 밖 diff, 실제 상용 결제 작동 징후가 있으면 다음 Task로 넘어가지 않는다. 실행 중 새 기능 요구를 끼워 넣지 않으며 필요하면 별도 계획 후보로만 기록한다.

> **에이전트 스코프**: 사용자가 `PLAN 전체 실행`을 요청하면 Task를 의존성 순서대로 하나씩 진행한다. Blueprint 구조는 동결하고 Verify 종료 코드 0과 Conclusion 갱신을 확인한 뒤 다음 Task로 이동한다. 프로덕션 공개 이후 카카오 재심사 접수는 전체 실행 승인에 포함되지 않으며 사용자의 별도 명시적 승인이 있어야 한다.

## Execution Plan

### Phase 1 — 법률·운영 정본 고정

#### Task 1.1 — consumer 법적 문안 정본 작성 [Unit: Atomic]

- **Task-ID**: 1.1
- **Pre-read**: `docs/memory.md`, `docs/CRITICAL_LOGIC.md`의 `#CL-57`, `apps/consumer/src/auth.ts`, `apps/consumer/src/hooks/useCart.ts`, `apps/consumer/src/hooks/useNotifications.ts`, `apps/consumer/src/app/checkout/page.tsx`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/orders/orders-create.service.ts`, `apps/api/src/payments/payments.service.ts`, `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/common/audit/audit.service.ts`, 개인정보보호위원회 2026 지침, 전자상거래법 제6조·제13조·제17조, Vercel·Railway·Firebase·Kakao 공식 문서
- **Target**: `docs/specs/legal/consumer-legal-documents.md`
- **Goal**: 개인정보처리방침과 이용약관 구현의 법률·운영 문안 정본을 고정한다.
- **Verify**: `git diff --check -- docs/specs/legal/consumer-legal-documents.md`
- **Conclusion**: 현재 consumer·API·운영 인프라를 기준으로 처리 항목, 보존기간, 필수 쿠키·브라우저 저장소, 수탁자·국외 처리, 권리 행사와 현재 미운영 판매 기능의 약관 경계를 정본으로 확정했다. 회원 탈퇴·카카오 연결 해제·자동 파기 미구현, Vercel Hobby의 DPA 비적용, 미국 Railway API 처리, 판매 개시 전 거래조건 확정은 후속 법률·운영 위험으로 남겼다. Verify 종료 코드 0.
- **Status**: done

#### Task 1.2 — 카카오 공개 증거 정본 확장 [Unit: Atomic]

- **Task-ID**: 1.2
- **Pre-read**: `docs/specs/ops/kakao-business-channel-proof.md`, `docs/specs/legal/consumer-legal-documents.md`, `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Target**: `docs/specs/ops/kakao-business-channel-proof.md`
- **Goal**: 카카오 심사용 공개 법적 고지 경로와 운영 검증 기준을 증거 정본에 추가한다.
- **Verify**: `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`
- **Conclusion**: `/privacy`·`/terms`의 비로그인 200, 필수 운영자·시행일 문구, 상호·footer 링크, 375×812 가시성, 콘솔 오류 0건을 공개 증거 기준으로 추가했다. 재심사 설명·제출 URL·민감 첨부 금지와 배포 SHA·Vercel·비대상 서비스·문서 버전 기록 절차를 고정했고, 실제 제출은 별도 승인 게이트로 유지했다. Verify 종료 코드 0.
- **Status**: done

### Phase 2 — 공개 페이지와 링크 구현

#### Task 2.1 — 법적 문서 실패 계약 추가 [Unit: Atomic]

- **Task-ID**: 2.1
- **Pre-read**: `docs/specs/legal/consumer-legal-documents.md`, `apps/consumer/src/app/layout.test.mjs`, `apps/consumer/src/app/page.test.mjs`, `apps/consumer/src/proxy.ts`
- **Target**: `apps/consumer/src/app/legal-documents.test.mjs`
- **Goal**: 법적 문서의 필수 내용과 금지 문구를 구현 전 실패 계약으로 고정한다.
- **Verify**: `node --check apps/consumer/src/app/legal-documents.test.mjs`
- **Conclusion**: 공통 Server Component 경계·홈/상호 문서 이동·하단 여백, 개인정보 처리·국외 처리·권리 행사 필수 문구, 약관의 비판매 경계·청약철회 금지 문구를 3개 계약으로 고정했다. 문법 검사는 종료 코드 0, 구현 전 실행은 대상 3개 파일 미존재로 예상 RED 3건을 확인했다.
- **Status**: done

#### Task 2.2 — 푸터 법적 링크 실패 계약 추가 [Unit: Atomic]

- **Task-ID**: 2.2
- **Pre-read**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`, `apps/consumer/src/components/BusinessInfoFooter.tsx`, `apps/consumer/src/app/page.test.mjs`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Goal**: 홈 푸터의 공개 법적 고지 링크를 구현 전 실패 계약으로 고정한다.
- **Verify**: `node --check apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: footer에서 `/privacy`·`/terms` 링크, 한국어 링크명, 법적 고지 내비게이션 레이블과 최소 터치 높이를 요구하는 계약을 추가했다. 문법 검사는 종료 코드 0, 구현 전 기존 5개 계약은 통과하고 신규 링크 계약 1건이 예상 RED임을 확인했다.
- **Status**: done

#### Task 2.3 — 법적 문서 공통 셸 구현 [Unit: Atomic]

- **Task-ID**: 2.3
- **Pre-read**: `apps/consumer/AGENTS.md`, 설치된 Next.js 문서의 `layouts-and-pages.md`·`server-and-client-components.md`·`metadata-and-og-images.md`, `apps/consumer/src/app/layout.tsx`, `apps/consumer/src/styles/globals.css`
- **Target**: `apps/consumer/src/components/LegalDocumentPage.tsx`
- **Goal**: 두 법적 문서가 공유할 공개·반응형·접근 가능 문서 셸을 구현한다.
- **Verify**: `pnpm biome check apps/consumer/src/components/LegalDocumentPage.tsx`
- **Conclusion**: 클라이언트 지시어 없이 동작하는 공통 Server Component를 구현했다. 홈·상호 법적 문서 링크, 운영자·시행일 메타정보, 의미 있는 `main`·`article`·`nav`, 줄바꿈 안전성, 최소 터치 높이와 고정 하단 내비게이션을 피하는 safe-area 포함 112px 여백을 제공한다. Biome Verify 종료 코드 0.
- **Status**: done

#### Task 2.4 — 개인정보처리방침 페이지 구현 [Unit: Atomic]

- **Task-ID**: 2.4
- **Pre-read**: `docs/specs/legal/consumer-legal-documents.md`, `apps/consumer/src/components/LegalDocumentPage.tsx`, `apps/consumer/src/lib/publicBusinessInfo.ts`, `apps/consumer/src/proxy.ts`
- **Target**: `apps/consumer/src/app/privacy/page.tsx`
- **Goal**: 실제 개인정보 처리 흐름을 설명하는 공개 개인정보처리방침을 구현한다.
- **Verify**: `pnpm biome check apps/consumer/src/app/privacy/page.tsx`
- **Conclusion**: 카카오 로그인·회원·주소록·브라우저 저장소·주문/결제 준비·알림·감사 흐름, 법정 보존기간과 수동 파기 책임, 제3자 제공 원칙, Vercel·Railway·Google 처리위탁과 국외 처리, 필수 쿠키, 권리 행사·구제·개정 절차를 공개 페이지에 구현했다. 상용 거래·마케팅·자동 탈퇴가 현재 운영된다고 오인할 문구는 제외했다. Biome Verify 종료 코드 0.
- **Status**: done

#### Task 2.5 — 이용약관 페이지 구현 [Unit: Atomic]

- **Task-ID**: 2.5
- **Pre-read**: `docs/specs/legal/consumer-legal-documents.md`, `apps/consumer/src/components/LegalDocumentPage.tsx`, `apps/consumer/src/lib/publicBusinessInfo.ts`, 전자상거래법 제13조·제17조, 전자상거래 표준약관 제10023호
- **Target**: `apps/consumer/src/app/terms/page.tsx`
- **Goal**: 현재 제공 서비스의 경계를 정확히 설명하는 공개 이용약관을 구현한다.
- **Verify**: `pnpm biome check apps/consumer/src/app/terms/page.tsx`
- **Conclusion**: 현재 공개 정보·카카오 로그인·회원·장바구니·주문 준비 화면과 상용 주문·결제·배송 미운영 경계를 명확히 분리했다. 계정 의무, 서비스 변경, 판매기능 활성화 전 확정할 결제·배송·반품 조건, 향후 계약 성립·청약철회 원칙, 개인정보·책임·분쟁 조항을 구현했고 미확정 비용이나 일괄 환불 제한은 넣지 않았다. Biome Verify 종료 코드 0.
- **Status**: done

#### Task 2.6 — 푸터 법적 링크 구현 [Unit: Atomic]

- **Task-ID**: 2.6
- **Pre-read**: `apps/consumer/src/components/BusinessInfoFooter.tsx`, `apps/consumer/src/components/BusinessInfoFooter.test.mjs`, 설치된 Next.js `layouts-and-pages.md`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 홈 사업자 푸터에 개인정보처리방침과 이용약관 링크를 구현한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 사업자 상세 다음에 `법적 고지` 내비게이션을 두고 개인정보처리방침·이용약관 링크를 추가했다. 기존 공통 링크 스타일의 최소 터치 높이와 줄바꿈 가능한 배치를 재사용했으며 기존 5개 footer 계약과 신규 링크 계약을 포함한 6개 테스트가 모두 통과했다. Verify 종료 코드 0.
- **Status**: done

#### Task 2.7 — 법적 문서 브라우저 검증기 추가 [Unit: Atomic]

- **Task-ID**: 2.7
- **Pre-read**: `apps/e2e/package.json`, `apps/e2e/tests/consumer-home.spec.ts`, `apps/consumer/src/app/privacy/page.tsx`, `apps/consumer/src/app/terms/page.tsx`
- **Target**: `apps/e2e/scripts/verify-consumer-legal-documents.mjs`
- **Goal**: 지정 URL의 공개 접근과 상호 이동을 데스크톱·모바일 브라우저에서 검증하는 실행기를 만든다.
- **Verify**: `node --check apps/e2e/scripts/verify-consumer-legal-documents.mjs`
- **Conclusion**: 지정 base URL에서 홈 footer→개인정보처리방침→이용약관→개인정보처리방침 동선을 비로그인으로 검증하는 Playwright 실행기를 추가했다. HTTP 200·경로 유지·제목·운영자·시행일, 데스크톱과 375×812 가로 넘침, 마지막 링크의 고정 UI 가림, console/page 오류 0건을 계약으로 고정했다. 문법 Verify 종료 코드 0.
- **Status**: done

### Phase 3 — 배포 후보 검증

#### Task 3.1 — consumer 법적 계약 통합 검증 [Unit: Atomic]

- **Task-ID**: 3.1
- **Pre-read**: `apps/consumer/src/app/legal-documents.test.mjs`, `apps/consumer/src/components/BusinessInfoFooter.test.mjs`, `apps/consumer/src/app/page.test.mjs`, Phase 2 구현 파일
- **Target**: `apps/consumer/src/app/legal-documents.test.mjs`
- **Goal**: 구현 전 RED였던 법적 문서와 푸터 계약을 모두 GREEN으로 전환한다.
- **Verify**: `node --test apps/consumer/src/app/legal-documents.test.mjs apps/consumer/src/components/BusinessInfoFooter.test.mjs apps/consumer/src/app/page.test.mjs`
- **Conclusion**: JSX 포맷 줄바꿈과 사업자 정본 상수 참조를 실제 렌더 계약에 맞게 정규화한 뒤 공통 셸 1건, 개인정보처리방침 1건, 이용약관 1건, 홈 3건, footer 6건 등 총 12개 계약이 모두 GREEN으로 통과했다. 필수 절·금지 문구·공개 링크와 하단 여백을 함께 검증했다. Verify 종료 코드 0.
- **Status**: done

#### Task 3.2 — consumer 타입 검증 [Unit: Atomic]

- **Task-ID**: 3.2
- **Pre-read**: `apps/consumer/tsconfig.json`, 이번 계획의 consumer TypeScript 변경 파일
- **Target**: `apps/consumer/src/components/LegalDocumentPage.tsx`
- **Goal**: 법적 고지 변경이 consumer TypeScript 계약을 만족하는지 확인한다.
- **Verify**: `pnpm --filter consumer exec tsc --noEmit`
- **Conclusion**: consumer 전체 TypeScript `tsc --noEmit` 검증에서 타입 오류 0건으로 종료 코드 0을 확인했다.
- **Status**: done

#### Task 3.3 — consumer 정적 품질 검증 [Unit: Atomic]

- **Task-ID**: 3.3
- **Pre-read**: `apps/consumer/package.json`, 이번 계획의 consumer 변경 파일
- **Target**: `apps/consumer/src/components/LegalDocumentPage.tsx`
- **Goal**: 법적 고지 변경이 consumer 정적 품질 규칙을 만족하는지 확인한다.
- **Verify**: `pnpm --filter consumer lint`
- **Conclusion**: consumer Biome lint는 종료 코드 0, 오류 0건으로 통과했다. 기존 checkout·auth·상품 UI 등 이번 변경 외 파일에서 `img`, 배열 인덱스 key, non-null assertion 등을 포함한 경고 23건이 보고됐으며 새 법적 문서·footer 변경 관련 lint 경고는 없었다.
- **Status**: done

#### Task 3.4 — consumer 프로덕션 빌드 검증 [Unit: Atomic]

- **Task-ID**: 3.4
- **Pre-read**: `apps/consumer/package.json`, `apps/consumer/src/app/privacy/page.tsx`, `apps/consumer/src/app/terms/page.tsx`
- **Target**: `apps/consumer/src/app/privacy/page.tsx`
- **Goal**: 두 공개 법적 고지가 consumer 프로덕션 빌드에 포함되는지 확인한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: Next.js 16.2.5 production build가 종료 코드 0으로 완료됐다. `/privacy`와 `/terms`는 모두 정적 prerender 경로(`○`)로 빌드됐고 TypeScript·페이지 데이터 수집·15개 정적 페이지 생성이 성공했다. webpack 대형 문자열 캐시 성능 경고는 있었으나 빌드 오류는 없었다.
- **Status**: done

#### Task 3.5 — 로컬 데스크톱·모바일 화면 검증 [Unit: Atomic]

- **Task-ID**: 3.5
- **Pre-read**: `apps/e2e/scripts/verify-consumer-legal-documents.mjs`, `apps/consumer/src/app/layout.tsx`, `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Target**: `apps/e2e/scripts/verify-consumer-legal-documents.mjs`
- **Goal**: 배포 후보의 법적 문서 가독성과 탐색 동선을 실제 브라우저에서 확인한다.
- **Verify**: `pnpm --filter e2e exec node scripts/verify-consumer-legal-documents.mjs http://127.0.0.1:3000`
- **Conclusion**: 최초 로컬 실행은 환경변수 미주입으로 Auth.js 500·API CORS 오류를 정확히 검출했다. 비밀값을 저장소에 복사하지 않고 기존 consumer production 로컬 환경을 프로세스에만 주입해 재빌드·재실행한 뒤 자동 검증이 통과했다. 데스크톱과 375×812에서 홈 footer→`/privacy`→`/terms`→`/privacy`, HTTP 200·비로그인 접근, 가로 넘침 0, 마지막 링크 가림 없음, console/page 오류 0건을 확인했다. agent-browser에서도 두 문서의 내용·오버레이 없음·375=375 폭·상호 이동을 확인하고 모바일 전체 화면을 육안 검토했다. Verify 종료 코드 0.
- **Status**: done

#### Task 3.6 — 카카오 재심사 보고서 사전 갱신 [Unit: Atomic]

- **Task-ID**: 3.6
- **Pre-read**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`, 현재 해당 파일의 사용자 변경 diff, Phase 1~3 Conclusion
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 법적 고지 구현과 배포 후보 검증 결과를 기존 재심사 보고서에 추가한다.
- **Verify**: `git diff --check`
- **Conclusion**: 기존 Task 4.9 반려 원인·상태 변경을 보존한 채 후속 consumer 법적 고지 섹션을 추가했다. 실제 처리·인프라·계약 위험 정본, RED→GREEN 구현, 12개 계약·타입·lint·정적 build·로컬 production 데스크톱/모바일·agent-browser 증적과 아직 수행하지 않은 배포·카카오 외부 변경을 기록했다. 전체 `git diff --check` 종료 코드 0.
- **Status**: done

### Phase 4 — 배포와 운영 증거

#### Task 4.1 — consumer 프로덕션 배포 기록 [Unit: Atomic]

- **Task-ID**: 4.1
- **Pre-read**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`, `docs/specs/ops/kakao-business-channel-proof.md`, 현재 branch·worktree·staging 상태, 기존 PR·Vercel·Railway 배포 계보
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 검증된 변경의 consumer 프로덕션 배포 계보를 보고서에 남긴다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: _(실행 후 checkpoint·push·PR·병합 SHA·Vercel 배포·비대상 서비스 상태를 기록)_
- **Status**: pending

#### Task 4.2 — 프로덕션 법적 고지 검증 기록 [Unit: Atomic]

- **Task-ID**: 4.2
- **Pre-read**: `apps/e2e/scripts/verify-consumer-legal-documents.mjs`, `docs/plans/REPORT_kakao_business_channel_reapproval.md`, 운영 도메인의 홈·개인정보처리방침·이용약관
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 운영 도메인의 법적 고지 공개 증적을 보고서에 남긴다.
- **Verify**: `pnpm --filter e2e exec node scripts/verify-consumer-legal-documents.mjs https://greenlove.co.kr`
- **Conclusion**: _(실행 후 HTTP 상태, 비로그인 접근, 데스크톱·모바일, 링크, 콘솔, 배포 SHA 결과를 기록)_
- **Status**: pending

#### Task 4.3 — 사용자 승인 카카오 재심사 기록 [Unit: Atomic]

- **Task-ID**: 4.3
- **Pre-read**: `docs/specs/ops/kakao-business-channel-proof.md`, `docs/plans/REPORT_kakao_business_channel_reapproval.md`, 운영 `/privacy`·`/terms` 최종 검증 결과, 사용자의 별도 재심사 승인 메시지
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 사용자 승인에 따른 카카오 재심사 접수 증적을 보고서에 남긴다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: _(별도 승인 후 제출 주소·연관성 설명·첨부 0건 원칙·접수 시각·접수 성공 화면을 기록)_
- **Status**: pending

### Phase 5 — 중단된 회차 직배송 인계 연결

#### Task 5.1 — 회차 직배송 재개 선행 조건 기록 [Unit: Atomic]

- **Task-ID**: 5.1
- **Pre-read**: `C:\Develop\greenhub\docs\plans\HANDOFF_mvp_round_direct_aligo_review_pause.md`, `C:\Develop\greenhub`의 branch·status·diff, 법적 고지 main 병합 SHA, consumer 프로덕션 검증, 카카오 재심사 결과
- **Target**: `C:\Develop\greenhub\docs\plans\HANDOFF_mvp_round_direct_aligo_review_pause.md`
- **Goal**: 법적 고지 완료와 최신 main 통합을 회차 직배송 재개 선행 조건으로 기록한다.
- **Verify**: `git -C C:/Develop/greenhub diff --check -- docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- **Conclusion**: _(실행 후 법적 고지·카카오 결과·main SHA·통합 여부·계속 중단 범위를 기록)_
- **Status**: pending

## Release Gate

- 사용자가 `PLAN 전체 실행`을 요청하기 전에는 Task 1.1도 시작하지 않는다.
- Task 1.1에서 실제 계정에 적용되는 Vercel·Railway·Google 계약의 법인명, 처리 국가, 연락처, 보존 조건을 확인하지 못하면 법적 페이지 구현을 중단한다.
- 사용자 확인에 따라 현재 상용 PG는 미운영으로 취급한다. 공개 서비스에서 실제 결제 승인이 가능한 징후를 발견하면 임의 결제·주문을 만들지 않고 판매 기능 정합성 작업을 별도 범위로 돌린다.
- 개인정보처리방침에 법정 보존기간을 쓰더라도 자동 파기 구현이 완료됐다고 표현하지 않는다. 담당자의 수동 권리 행사·파기 절차가 운영 정본에 있어야 배포 후보가 된다.
- 이용약관은 미확정 반품비·직배송 기준·택배 조건을 만들지 않는다. 상거래 개시는 이 조건과 checkout 사전 고지가 별도 계획에서 확정되기 전까지 차단된 상태로 유지한다.
- 구현 전 계약 테스트의 예상 RED를 확인하고 구현 후 같은 계약을 GREEN으로 전환한다.
- 소스 계약, consumer 타입 검사, consumer lint, consumer production build, 브라우저 검증기 문법 검사, 실제 브라우저 검증, `git diff --check`가 모두 통과해야 checkpoint를 만든다.
- checkpoint 전 변경 파일이 계획의 Target과 기존 예상 변경 3개 밖으로 늘어나면 중단한다.
- checkpoint는 공개 GitHub `noreply` 메타데이터와 한국어 commit 메시지를 사용한다.
- push·PR·main 병합은 사용자 저장소의 기존 병합 방식을 따른다. consumer production이 병합 SHA와 일치하는지 확인한다.
- seller·driver는 Ignored Build Step 결과를 확인하고 Railway API는 watched path 미변경을 확인한다. 예상 밖 배포가 생겨도 임의 롤백하지 않는다.
- 프로덕션에서 홈·`/privacy`·`/terms` HTTP 200, 비로그인 접근, 제목, 시행일, 사업자 관계, 푸터 링크, 상호 문서 링크, 모바일 가로 넘침 없음, 하단 가림 없음, 콘솔 오류 0건을 확인한다.
- 카카오 재심사는 프로덕션 검증이 끝난 뒤 멈춘다. 사용자의 별도 명시적 승인 없이는 카카오 화면을 열어 제출하지 않는다.
- 승인 후 홈페이지 주소는 `https://greenlove.co.kr`로 제출한다. 사업자등록증 원본, 비공개 계정 정보, 주민등록번호, 발급번호 등 불필요한 자료는 첨부하지 않는다.
- 연관성 설명에는 `디어 오키드가 그린러브 서비스를 직접 운영하며 개인정보처리방침과 이용약관에서 동일 운영 주체를 확인할 수 있다`는 사실을 입력 글자 수 안에서 반영한다.
- 카카오 재심사 승인 여부는 법률 준수 전체에 대한 인증이 아니다. 회원 탈퇴·연결 해제·자동 파기·판매 거래조건은 별도 후속 위험으로 계속 관리한다.
- Task 5.1은 회차 직배송 원계획의 완료 Task를 바꾸지 않는다. 법적 고지 완료, 카카오 접수 결과, 최신 main 통합을 재개 전 확인사항으로만 추가한다.
- Task 5.1 실행 전 `C:\Develop\greenhub`의 기존 untracked 계획 파일을 다시 확인하고 보존한다. 예상 밖 변경이 있으면 중단한다.

## External Action Gate

- **consumer 프로덕션 배포**: `PLAN 전체 실행` 승인 범위에 포함한다.
- **카카오 재심사 접수**: `PLAN 전체 실행` 승인 범위에 포함하지 않는다.
- **필요한 추가 승인**: 운영 `/privacy`·`/terms` 검증 결과를 사용자에게 보고한 뒤, 사용자가 카카오 재심사 접수를 명시적으로 승인해야 Task 4.3을 실행한다.
- **승인 대기 중 상태**: 코드·배포는 유지하고 카카오·이메일·DNS·채널·ALIGO를 변경하지 않는다.
- **회차 직배송 상태**: Task 5.1은 인계 문서만 갱신하며 회차 생성, `salesMode` 변경, 결제·배송 활성화, 기존 Task 재개를 허용하지 않는다.

## Closeout Roll-up

- **구현**: _(미완료)_
- **자동 검증**: _(미완료)_
- **화면 검증**: _(미완료)_
- **프로덕션 배포**: _(미완료)_
- **카카오 재심사**: _(별도 사용자 승인 대기)_
- **회차 직배송 인계**: _(미완료)_
- **최종 인계**: _(branch·HEAD·status·전체 diff·staging·공식 근거·수정 파일·테스트·타입·lint·build·화면 검증·commit·push·PR·병합·Vercel 배포·외부 서비스 변경·회차 직배송 통합 여부를 실행 후 기록)_
- **후속 위험**: 회원 탈퇴·카카오 연결 해제 웹훅·자동 파기·상거래 거래조건·결제 활성화·배송 운영 기준

## Conclusion

_(계획 실행 완료 후 전체 Task 결과, 배포 계보, 운영 검증, 카카오 접수 상태, 잔여 위험을 기록)_
