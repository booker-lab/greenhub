import Link from 'next/link';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

const termStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  whiteSpace: 'nowrap',
} as const;

const detailStyle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: 1.6,
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere',
} as const;

const itemStyle = {
  alignItems: 'baseline',
  columnGap: 6,
  display: 'grid',
  flex: '0 1 auto',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  minWidth: 0,
} as const;

const wideItemStyle = {
  ...itemStyle,
  flex: '1 1 280px',
} as const;

const linkStyle = {
  alignItems: 'center',
  color: 'var(--color-primary)',
  display: 'inline-flex',
  minHeight: 'var(--touch-target)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const;

export default function BusinessInfoFooter() {
  return (
    <footer
      role="contentinfo"
      style={{
        background: 'var(--color-surface-muted)',
        borderTop: 'var(--border)',
        marginTop: 40,
        padding: '24px 16px 28px',
      }}
      aria-labelledby="business-info-title"
    >
      <h2
        id="business-info-title"
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--fw-bold)',
          margin: '0 0 14px',
        }}
      >
        {PUBLIC_BUSINESS_INFO.brand} 사업자 정보
      </h2>

      <dl
        style={{
          columnGap: 18,
          display: 'flex',
          flexWrap: 'wrap',
          margin: 0,
          rowGap: 4,
        }}
      >
        <div style={itemStyle}>
          <dt style={termStyle}>상호</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.businessName}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>대표</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.representative}</dd>
        </div>
        <div style={wideItemStyle}>
          <dt style={termStyle}>주소</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.address}</dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>사업자등록번호</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.registrationNumber}</dd>
        </div>
        <div style={wideItemStyle}>
          <dt style={termStyle}>호스팅서비스 제공자</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.hostingProvider}</dd>
        </div>
        <div style={wideItemStyle}>
          <dt style={termStyle}>이메일</dt>
          <dd style={detailStyle}>
            <a href={PUBLIC_BUSINESS_INFO.emailHref} style={linkStyle}>
              {PUBLIC_BUSINESS_INFO.email}
            </a>
          </dd>
        </div>
        <div style={itemStyle}>
          <dt style={termStyle}>고객센터</dt>
          <dd style={detailStyle}>
            <a href={PUBLIC_BUSINESS_INFO.phoneHref} style={linkStyle}>
              {PUBLIC_BUSINESS_INFO.phone}
            </a>
          </dd>
        </div>
        <div style={wideItemStyle}>
          <dt style={termStyle}>상담가능시간</dt>
          <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.supportHours}</dd>
        </div>
      </dl>

      <nav
        aria-label="법적 고지"
        style={{
          borderTop: 'var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0 20px',
          marginTop: 18,
          paddingTop: 10,
        }}
      >
        <Link href="/privacy" style={linkStyle}>
          개인정보처리방침
        </Link>
        <Link href="/terms" style={linkStyle}>
          이용약관
        </Link>
      </nav>
    </footer>
  );
}
