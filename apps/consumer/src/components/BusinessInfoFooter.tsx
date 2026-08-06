const BUSINESS_INFO = {
  brand: '그린러브',
  businessName: '디어오키드',
  representative: '조정연',
  registrationNumber: '505-28-01702',
  phone: '010-4452-2104',
  phoneHref: 'tel:01044522104',
  email: 'support@greenlove.co.kr',
  emailHref: 'mailto:support@greenlove.co.kr',
  relationship: '그린러브는 디어오키드가 운영하는 화훼 판매 브랜드입니다.',
} as const;

const termStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
} as const;

const detailStyle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: 1.6,
  margin: 0,
  minWidth: 0,
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
      style={{
        background: 'var(--color-surface-muted)',
        borderTop: 'var(--border)',
        marginTop: 40,
        padding: '24px 16px',
      }}
    >
      <h2
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--fw-bold)',
          margin: 0,
        }}
      >
        {BUSINESS_INFO.brand} 사업자 정보
      </h2>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--font-size-sm)',
          lineHeight: 1.6,
          margin: '8px 0 20px',
        }}
      >
        {BUSINESS_INFO.relationship}
      </p>

      <dl
        style={{
          display: 'grid',
          gap: '8px 16px',
          gridTemplateColumns: 'max-content minmax(0, 1fr)',
          margin: 0,
        }}
      >
        <dt style={termStyle}>상호</dt>
        <dd style={detailStyle}>{BUSINESS_INFO.businessName}</dd>
        <dt style={termStyle}>대표자</dt>
        <dd style={detailStyle}>{BUSINESS_INFO.representative}</dd>
        <dt style={termStyle}>사업자등록번호</dt>
        <dd style={detailStyle}>{BUSINESS_INFO.registrationNumber}</dd>
        <dt style={termStyle}>고객센터</dt>
        <dd style={detailStyle}>
          <a href={BUSINESS_INFO.phoneHref} style={linkStyle}>
            {BUSINESS_INFO.phone}
          </a>
        </dd>
        <dt style={termStyle}>이메일</dt>
        <dd style={detailStyle}>
          <a href={BUSINESS_INFO.emailHref} style={linkStyle}>
            {BUSINESS_INFO.email}
          </a>
        </dd>
      </dl>
    </footer>
  );
}
