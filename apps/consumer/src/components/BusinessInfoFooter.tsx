import Link from 'next/link';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

// 쇼핑앱 footer 문법: 고객센터를 크게 위에, 약관 링크 한 줄, 법정 사업자 정보는 작은 회색 글로 아래에.
// 사업자 정보 13px은 consumer AGENTS.md 글꼴 크기 예외(법정 고지 footer)다.

const infoTextStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 13,
  lineHeight: 1.7,
} as const;

const itemStyle = {
  display: 'inline-flex',
  gap: 4,
  minWidth: 0,
} as const;

const termStyle = {
  ...infoTextStyle,
  fontWeight: 'var(--fw-bold)',
  whiteSpace: 'nowrap',
} as const;

const detailStyle = {
  ...infoTextStyle,
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere',
} as const;

const contactButtonStyle = {
  alignItems: 'center',
  background: 'var(--color-bg)',
  border: 'var(--border)',
  borderRadius: 'var(--radius-full)',
  color: 'var(--color-text)',
  display: 'inline-flex',
  flex: 1,
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  justifyContent: 'center',
  minHeight: 'var(--touch-target)',
  textDecoration: 'none',
} as const;

const legalLinkStyle = {
  alignItems: 'center',
  color: 'var(--color-text-secondary)',
  display: 'inline-flex',
  fontSize: 'var(--font-size-sm)',
  minHeight: 'var(--touch-target)',
  textDecoration: 'none',
} as const;

export default function BusinessInfoFooter() {
  return (
    <footer
      role="contentinfo"
      style={{
        background: 'var(--color-surface-muted)',
        marginTop: 40,
        padding: '28px 16px 32px',
      }}
      aria-labelledby="business-info-title"
    >
      <p style={{ ...infoTextStyle, fontWeight: 'var(--fw-bold)', margin: 0 }}>고객센터</p>
      <a
        href={PUBLIC_BUSINESS_INFO.phoneHref}
        style={{
          color: 'var(--color-text)',
          display: 'inline-block',
          fontSize: 22,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-extrabold)',
          marginTop: 2,
          textDecoration: 'none',
        }}
      >
        {PUBLIC_BUSINESS_INFO.phone}
      </a>
      <p style={{ ...infoTextStyle, margin: '2px 0 0' }}>
        상담가능시간 {PUBLIC_BUSINESS_INFO.supportHours}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <a href={PUBLIC_BUSINESS_INFO.phoneHref} style={contactButtonStyle}>
          전화 문의
        </a>
        <a href={PUBLIC_BUSINESS_INFO.emailHref} style={contactButtonStyle}>
          이메일 문의
        </a>
      </div>

      <nav
        aria-label="법적 고지"
        style={{
          alignItems: 'center',
          borderTop: 'var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0 12px',
          marginTop: 24,
        }}
      >
        <Link href="/terms" style={legalLinkStyle}>
          이용약관
        </Link>
        <span aria-hidden style={{ background: 'var(--color-border)', height: 12, width: 1 }} />
        <Link
          href="/privacy"
          style={{ ...legalLinkStyle, color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
        >
          개인정보처리방침
        </Link>
      </nav>

      <h2
        id="business-info-title"
        style={{ ...infoTextStyle, fontWeight: 'var(--fw-bold)', margin: '4px 0 2px' }}
      >
        {PUBLIC_BUSINESS_INFO.brand} 사업자 정보
      </h2>
      <dl style={{ columnGap: 10, display: 'flex', flexWrap: 'wrap', margin: 0, rowGap: 0 }}>
        <div style={itemStyle}>
          <dt style={termStyle}>상호</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.businessName}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>대표</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.representative}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>사업자등록번호</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.registrationNumber}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>주소</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.address}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>이메일</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.email}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>호스팅서비스 제공자</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.hostingProvider}</dd>
        </div>
      </dl>

      <p
        style={{
          color: 'var(--color-text-disabled)',
          fontFamily: 'var(--font-brand)',
          fontSize: 13,
          fontWeight: 800,
          margin: '16px 0 0',
        }}
      >
        © Green Love
      </p>
    </footer>
  );
}
