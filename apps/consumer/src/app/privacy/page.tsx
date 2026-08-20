import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import LegalDocumentPage from '@/components/LegalDocumentPage';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

export const metadata: Metadata = {
  title: '개인정보처리방침 | 그린러브',
  description: '디어 오키드가 운영하는 그린러브의 개인정보처리방침입니다.',
  alternates: { canonical: '/privacy' },
};

const EFFECTIVE_DATE = '2026년 8월 19일';

const sectionStyle = {
  marginTop: 34,
} as const;

const headingStyle = {
  fontSize: 'var(--font-size-xl)',
  letterSpacing: '-0.02em',
  lineHeight: 1.4,
  margin: '0 0 12px',
} as const;

const listStyle = {
  margin: '10px 0 0',
  paddingLeft: 22,
} as const;

const cardStyle = {
  background: 'var(--color-surface-muted)',
  border: 'var(--border)',
  borderRadius: 'var(--radius-md)',
  marginTop: 12,
  padding: 16,
} as const;

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="개인정보처리방침"
      description="디어 오키드(이하 ‘회사’)는 그린러브 서비스를 운영하며 이용자의 개인정보를 보호합니다."
      effectiveDate={EFFECTIVE_DATE}
    >
      <p>
        회사는 개인정보 보호법 등 관계 법령을 준수하고, 개인정보를 필요한 범위에서 적법하고 안전하게
        처리합니다. 이 방침은 그린러브 consumer 웹과 연결된 GreenLove API에 적용됩니다.
      </p>

      <Section title="1. 처리 목적, 항목 및 수집 방법">
        <div style={cardStyle}>
          <h3>카카오 로그인·회원 관리</h3>
          <p>
            본인 식별, 계정 생성, 로그인 유지, 부정 이용 방지와 문의 대응을 위해 카카오 계정 식별자,
            이름, 이메일, 로그인 세션·접근 토큰·갱신 토큰, 접속 IP와 로그를 처리합니다. 이용자가
            카카오 로그인을 선택할 때 Kakao Corp.에서 제공받거나 서비스 이용 과정에서 생성됩니다.
          </p>
        </div>
        <div style={cardStyle}>
          <h3>회원 프로필·주소록</h3>
          <p>
            회원 기능과 연락처·배송지 저장을 위해 이름, 이메일, 선택 입력 전화번호, 역할, 매장 연결
            정보, 주소명, 우편번호, 기본주소, 상세주소와 선택적 알림 토큰을 처리합니다.
          </p>
        </div>
        <div style={cardStyle}>
          <h3>장바구니·주문 및 결제 준비 경로</h3>
          <p>
            장바구니에는 상품, 가격, 수량, 판매유형, 배송방법, 매장, 요청일이 포함될 수 있습니다.
            해당 기능 이용 시 구매자 이름·전화번호·주소, 상품·매장·배송방법·요청일·금액, 주문·결제
            식별자, 결제수단과 결제·환불 상태를 처리할 수 있습니다. 현재 상용 주문·결제·배송
            서비스는 운영하지 않습니다.
          </p>
        </div>
        <div style={cardStyle}>
          <h3>알림·보안·감사</h3>
          <p>
            주문 상태와 서비스 안내, 장애 대응과 부정 이용 방지를 위해 이용자·주문 식별자, 수신
            전화번호, 메시지 내용·발송 상태·오류, IP, 작업 내용과 발생 시각을 처리할 수 있습니다.
            현재 별도 마케팅 알림이나 자동화된 의사결정은 운영하지 않습니다.
          </p>
        </div>
        <p>
          회사는 주민등록번호, 건강정보 등 민감정보와 만 14세 미만 아동의 개인정보를 의도적으로
          수집하지 않습니다. 만 14세 미만임을 알게 된 경우 이용을 제한하고 필요한 삭제 조치를
          합니다.
        </p>
      </Section>

      <Section title="2. 보유 및 이용기간">
        <ul style={listStyle}>
          <li>회원 프로필·주소록: 회원 탈퇴 또는 삭제 요청 처리 완료 시까지</li>
          <li>
            로그인 세션: 마지막 사용 후 최대 30일, API 접근 토큰 약 1시간, consumer 갱신 토큰 기본
            30일
          </li>
          <li>
            표시·광고 기록: 6개월, 계약·청약철회 기록: 5년, 대금결제·재화 공급 기록: 5년, 소비자
            불만·분쟁처리 기록: 3년
          </li>
          <li>
            접속·감사·보안 로그: 목적 달성 또는 관련 분쟁 종료 시까지. 법령상 더 긴 보존 의무가
            있으면 해당 기간까지
          </li>
        </ul>
        <p>
          기간이 끝나고 다른 법적 근거가 없으면 전자 파일은 복구가 곤란한 방법으로 삭제합니다. 일반
          회원·주문 관련 정보의 자동 만료 삭제는 현재 구현되어 있지 않아 운영자가 권리 요청과 정기
          점검을 통해 파기합니다. 법정 보존정보는 다른 개인정보와 분리해 보관합니다.
        </p>
      </Section>

      <Section title="3. 개인정보의 제3자 제공">
        <p>
          회사는 위 목적 범위에서 개인정보를 처리하며, 이용자의 동의 또는 법률상 근거 없이 외부
          제3자에게 제공하지 않습니다. 디어 오키드 내부 판매·배송 담당자에게는 업무상 필요한 최소
          범위의 접근 권한만 부여할 수 있습니다. 외부 판매자나 배송업체를 이용하게 되면 제공받는 자,
          목적, 항목과 보유기간을 확정해 이 방침과 거래 화면에서 먼저 안내하겠습니다.
        </p>
      </Section>

      <Section title="4. 개인정보 처리위탁과 외부 서비스">
        <ul style={listStyle}>
          <li>Vercel Inc.: consumer 웹 호스팅, 서버 렌더링과 인증 콜백 처리</li>
          <li>Railway Corporation: GreenLove API 호스팅과 보안 운영</li>
          <li>
            Google Cloud Korea LLC / Google Cloud·Firebase: Firestore 데이터베이스와 관련 서버 자원
            제공
          </li>
        </ul>
        <p>
          카카오 로그인은 이용자의 선택에 따라 Kakao Corp.가 카카오 계정 정보를 회사에 제공하는 외부
          로그인 서비스입니다. 다음 우편번호 서비스는 주소 검색 때 브라우저에서 직접 불러오는 Kakao
          Corp.의 외부 스크립트이며, 각 제공자가 접속정보를 처리할 수 있습니다. PortOne과
          결제사업자는 현재 상용 처리 수탁자로 운영하지 않습니다.
        </p>
      </Section>

      <Section title="5. 개인정보의 국외 처리">
        <div style={cardStyle}>
          <h3>Vercel Inc.</h3>
          <p>
            사이트 접속·로그인 콜백 시 IP, 브라우저·요청 정보와 인증 콜백·세션 처리 정보가
            네트워크를 통해 미국 등 Vercel과 공개 하위처리자의 운영 지역에서 처리될 수 있습니다.
            목적은 웹 제공과 로그인 처리이며, 서비스 제공과 계약·법령상 필요한 기간 보관됩니다.
            문의: privacy@vercel.com
          </p>
        </div>
        <div style={cardStyle}>
          <h3>Railway Corporation</h3>
          <p>
            API 호출 시 회원·주소·주문 준비·결제 준비·알림·로그 관련 요청과 응답이 네트워크를 통해
            미국 캘리포니아에서 처리됩니다. 목적은 API 제공과 보안 운영이며, 각 항목의 보유기간과
            계약상 필요한 기간 보관됩니다. 문의: privacy@railway.com
          </p>
        </div>
        <div style={cardStyle}>
          <h3>Google Cloud Korea LLC와 공개 하위처리자</h3>
          <p>
            Firestore의 기본 저장 위치는 대한민국 서울입니다. 기술지원·보안과 하위처리 과정에서
            회원·주소·주문·결제·알림·감사 정보가 Google의 공개 하위처리자 소재국에서 처리될 수
            있으며 각 항목의 보유기간을 따릅니다.
          </p>
        </div>
        <p>
          이용자는 고객센터에 국외 처리 중단을 요청할 수 있습니다. 중단이 기술적으로 어려우면
          로그인·주소록·주문 관련 기능이 제한될 수 있으나, 로그인하지 않은 공개 콘텐츠는 계속 이용할
          수 있습니다. 처리 국가와 사업자는{' '}
          <a href="https://vercel.com/legal/sub-processors">Vercel 하위처리자 목록</a>,{' '}
          <a href="https://railway.com/legal/subprocessors">Railway 하위처리자 목록</a>,{' '}
          <a href="https://cloud.google.com/terms/subprocessors">Google Cloud 하위처리자 목록</a>
          에서 확인할 수 있습니다.
        </p>
      </Section>

      <Section title="6. 쿠키와 브라우저 저장소">
        <ul style={listStyle}>
          <li>
            필수 쿠키: Auth.js 로그인 세션, CSRF, callback URL, PKCE, state 등 로그인 유지와 요청
            위조 방지에 필요한 쿠키
          </li>
          <li>
            유효기간: 로그인 세션은 마지막 사용 후 최대 30일, PKCE·state 등 일회성 OAuth 쿠키는 최대
            15분
          </li>
          <li>
            브라우저 저장소: 장바구니·알림 읽음 상태는 localStorage, 체크아웃 전달값은
            sessionStorage에 저장
          </li>
        </ul>
        <p>
          브라우저 설정에서 쿠키와 사이트 데이터를 삭제하거나 차단할 수 있습니다. 필수 쿠키를
          차단하면 로그인과 회원 기능이 동작하지 않을 수 있습니다. 현재 광고·행태 분석·마케팅 목적
          쿠키는 사용하지 않습니다.
        </p>
      </Section>

      <Section title="7. 이용자의 권리와 행사 방법">
        <p>
          이용자는 개인정보 열람, 정정·삭제, 처리정지, 동의 철회와 카카오 연결 해제를 요청할 수
          있습니다. 자동 회원 탈퇴 기능은 아직 제공하지 않으며, 아래 고객센터로 본인 확인에 필요한
          최소 정보를 보내면 운영자가 확인 후 결과를 안내합니다. 법정 보존정보는 해당 기간 동안 분리
          보관할 수 있습니다.
        </p>
        <ul style={listStyle}>
          <li>
            이메일: <a href={PUBLIC_BUSINESS_INFO.emailHref}>{PUBLIC_BUSINESS_INFO.email}</a>
          </li>
          <li>
            전화: <a href={PUBLIC_BUSINESS_INFO.phoneHref}>{PUBLIC_BUSINESS_INFO.phone}</a>
          </li>
          <li>상담가능시간: {PUBLIC_BUSINESS_INFO.supportHours}</li>
        </ul>
      </Section>

      <Section title="8. 안전성 확보조치와 권리 구제">
        <p>
          회사는 접근권한 최소화, 인증정보 보호, 전송구간 암호화, 접속·감사 기록과 정기 업데이트 등
          필요한 안전조치를 시행합니다. 침해 신고는 개인정보침해 신고센터(privacy.kisa.or.kr, 국번
          없이 118), 분쟁조정은 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972)를 이용할 수
          있습니다.
        </p>
      </Section>

      <Section title="9. 방침의 변경">
        <p>
          이 방침은 {EFFECTIVE_DATE}부터 시행합니다. 중요한 변경은 시행 전에 서비스 화면에서 적용일,
          변경 이유와 주요 내용을 알리고 이전 버전을 확인할 수 있도록 보관하겠습니다. 최초 공개
          버전으로 이전 버전은 없습니다.
        </p>
        <p>
          서비스 이용 조건은 <a href="/terms">이용약관</a>에서 확인할 수 있습니다.
        </p>
      </Section>
    </LegalDocumentPage>
  );
}
