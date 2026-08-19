import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import LegalDocumentPage from '@/components/LegalDocumentPage';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

export const metadata: Metadata = {
  title: '이용약관 | 그린러브',
  description: '디어 오키드가 운영하는 그린러브의 이용약관입니다.',
  alternates: { canonical: '/terms' },
};

const EFFECTIVE_DATE = '2026년 8월 19일';

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

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={headingStyle}>{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <LegalDocumentPage
      title="이용약관"
      description="이 약관은 디어 오키드가 운영하는 그린러브 서비스의 이용 조건과 회사·이용자의 권리 및 책임을 정합니다."
      effectiveDate={EFFECTIVE_DATE}
    >
      <Section title="제1조 목적과 운영자">
        <p>
          이 약관은 디어 오키드(이하 ‘회사’)가 제공하는 그린러브 consumer 웹과 관련 회원 기능의 이용
          조건을 정하는 것을 목적으로 합니다. 공개 사업자 정보와 연락처는 홈페이지 하단에서 확인할
          수 있습니다.
        </p>
      </Section>

      <Section title="제2조 용어">
        <ul style={listStyle}>
          <li>‘이용자’는 서비스를 열람하거나 사용하는 사람을 말합니다.</li>
          <li>
            ‘회원’은 카카오 로그인을 통해 계정을 생성하고 회원 기능을 사용하는 이용자를 말합니다.
          </li>
          <li>‘상품정보’는 현재 열람할 수 있는 화훼 상품의 설명·가격 등 표시 정보를 말합니다.</li>
          <li>
            ‘판매기능’은 주문 접수, 결제, 재화 공급, 배송과 환급을 포함하는 상용 거래 기능을
            말합니다.
          </li>
        </ul>
      </Section>

      <Section title="제3조 현재 제공하는 서비스">
        <p>
          현재 서비스는 공개 상품·사업자 정보 열람, 카카오 로그인, 회원 프로필·주소록, 장바구니와
          주문 준비 화면을 제공합니다. 2026년 8월 19일 현재 상용 주문·결제·배송 서비스를 운영하지
          않습니다. 상품의 표시나 장바구니 담기는 매매계약의 성립을 뜻하지 않습니다.
        </p>
      </Section>

      <Section title="제4조 약관의 효력과 변경">
        <p>
          이 약관은 서비스 화면에 게시한 시행일부터 적용됩니다. 회사는 관계 법령을 위반하지 않는
          범위에서 약관을 변경할 수 있고 적용일, 변경 이유와 주요 내용을 시행 전에 알립니다.
          이용자에게 불리한 중요한 변경에는 합리적인 사전 고지기간을 둡니다.
        </p>
      </Section>

      <Section title="제5조 계정과 이용자의 의무">
        <p>
          이용자는 카카오 로그인을 통해 계정을 사용할 수 있으며 정확한 정보를 제공하고 자신의 계정과
          기기를 안전하게 관리해야 합니다. 다음 행위를 해서는 안 됩니다.
        </p>
        <ul style={listStyle}>
          <li>타인의 정보를 사용하거나 계정을 부정하게 이용하는 행위</li>
          <li>서비스 운영을 방해하거나 시스템에 비정상적으로 접근하는 행위</li>
          <li>회사 또는 제3자의 권리와 관계 법령을 침해하는 행위</li>
        </ul>
        <p>
          이상 사용, 보안 위험 또는 법령 위반이 확인되면 회사는 필요한 범위에서 이용을 제한하고
          가능한 경우 사유를 안내할 수 있습니다.
        </p>
      </Section>

      <Section title="제6조 서비스의 변경과 중단">
        <p>
          회사는 점검, 장애, 천재지변, 통신망·외부 서비스 문제 또는 운영상 필요가 있을 때 서비스를
          변경하거나 일시 중단할 수 있습니다. 예측할 수 있으면 사전에, 긴급한 경우에는 사후에
          알립니다. 이 조항은 회사의 고의 또는 과실에 따른 법정 책임을 일률적으로 배제하지 않습니다.
        </p>
      </Section>

      <Section title="제7조 판매기능 활성화 전 고지">
        <p>
          회사는 판매기능 활성화 전에 다음 조건을 확정하여 상품, 주문, 결제 화면과 이 약관에 먼저
          안내합니다.
        </p>
        <ul style={listStyle}>
          <li>결제수단과 결제대행 계약, 계약 성립 시점과 주문 취소 절차</li>
          <li>재화 공급 시기, 자체 회차 직배송의 지역·회차·배송비·책임 기준</li>
          <li>택배 도입 여부와 배송비·도서산간비·반송지·반품 비용 부담 기준</li>
          <li>청약철회 기간과 방법, 상품별 제한 사유, 환급 기한과 방식</li>
          <li>판매 개시 전 관계 법령상 필요한 사업자 고지</li>
        </ul>
        <p>
          아직 정하지 않은 비용과 일정은 임의로 추정하지 않습니다. 신선화훼의 가치 감소 등 법률상
          청약철회 제한을 적용하려면 상품별 제한 사유를 거래 전에 명확히 표시하고 이용자가 확인할 수
          있게 합니다.
        </p>
      </Section>

      <Section title="제8조 향후 계약 성립과 청약철회의 원칙">
        <p>
          판매기능이 활성화되면 주문 제출만으로 계약이 확정된 것으로 보지 않고, 결제 완료와 회사의
          주문 승낙 통지가 모두 이뤄진 때 계약이 성립하는 것으로 정합니다. 재고 부족이나 가격 표시
          오류 등으로 승낙할 수 없으면 신속히 알리고 이미 받은 금액을 환급합니다.
        </p>
        <p>
          청약철회, 반품과 환급은 전자상거래법 등 강행규정에 따르며 소비자의 법정 권리를 일률적으로
          제한하지 않습니다. 구체적인 방법과 비용은 판매기능 개시 전에 확정해 거래 화면에서
          안내합니다.
        </p>
      </Section>

      <Section title="제9조 개인정보와 지식재산권">
        <p>
          개인정보의 처리 목적, 보유기간과 권리 행사 방법은 <a href="/privacy">개인정보처리방침</a>
          을 따릅니다. 서비스에 표시된 콘텐츠의 권리는 회사 또는 정당한 권리자에게 있으며, 이용자는
          허가 없이 복제·배포하거나 영리 목적으로 이용해서는 안 됩니다.
        </p>
      </Section>

      <Section title="제10조 책임의 범위">
        <p>
          회사는 서비스를 안정적으로 제공하기 위해 합리적인 노력을 합니다. 불가항력, 이용자 귀책사유
          또는 회사가 합리적으로 통제하기 어려운 외부 서비스 장애에 대해서는 관계 법령이 허용하는
          범위에서 책임이 제한될 수 있습니다. 회사의 고의·중과실이나 법률상 책임까지 면제하지
          않습니다.
        </p>
      </Section>

      <Section title="제11조 준거법, 관할법원 및 문의">
        <p>
          이 약관에는 대한민국 법률을 적용합니다. 분쟁이 생기면 당사자 간 협의를 우선하며, 해결되지
          않으면 민사소송법 등 관계 법령에서 정한 관할법원에 따릅니다.
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
        <p>이 약관은 {EFFECTIVE_DATE}부터 시행합니다.</p>
      </Section>
    </LegalDocumentPage>
  );
}
