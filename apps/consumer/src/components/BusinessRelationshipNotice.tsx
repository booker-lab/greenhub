import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

const termStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--fw-medium)',
} as const;

const detailStyle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  margin: 0,
} as const;

const linkStyle = {
  alignItems: 'center',
  color: 'var(--color-primary)',
  display: 'inline-flex',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  minHeight: 'var(--touch-target)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const;

export default function BusinessRelationshipNotice() {
  return (
    <section
      aria-labelledby="business-relationship-title"
      style={{
        background: 'var(--color-primary-surface)',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
        marginBottom: 24,
        padding: '20px 16px',
      }}
    >
      <p
        style={{
          color: 'var(--color-primary)',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--fw-bold)',
          margin: '0 0 6px',
        }}
      >
        카카오톡 채널·쇼핑몰 운영 정보
      </p>
      <h2
        id="business-relationship-title"
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--fw-bold)',
          lineHeight: 1.4,
          margin: 0,
        }}
      >
        그린러브 운영 안내
      </h2>
      <p
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-sm)',
          lineHeight: 1.7,
          margin: '8px 0 16px',
        }}
      >
        {PUBLIC_BUSINESS_INFO.relationship}
      </p>
      <a
        href={PUBLIC_BUSINESS_INFO.kakaoChannel.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...linkStyle, marginBottom: 16 }}
        aria-label={`카카오톡 채널 ${PUBLIC_BUSINESS_INFO.kakaoChannel.name} 새 창에서 열기`}
      >
        카카오톡 채널 ‘{PUBLIC_BUSINESS_INFO.kakaoChannel.name}’ 바로가기
      </a>
      <dl
        style={{
          display: 'grid',
          gap: '6px 12px',
          gridTemplateColumns: 'max-content minmax(0, 1fr)',
          margin: 0,
        }}
      >
        <dt style={termStyle}>운영 사업자</dt>
        <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.businessName}</dd>
        <dt style={termStyle}>대표자</dt>
        <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.representative}</dd>
        <dt style={termStyle}>사업자등록번호</dt>
        <dd style={detailStyle}>{PUBLIC_BUSINESS_INFO.registrationNumber}</dd>
      </dl>
      <h3
        id="featured-products-title"
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          margin: '20px 0 4px',
        }}
      >
        그린러브 대표 판매상품
      </h3>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--font-size-xs)',
          lineHeight: 1.6,
          margin: '0 0 4px',
        }}
      >
        현재 판매 중인 화훼 상품을 확인할 수 있습니다.
      </p>
      <ul aria-labelledby="featured-products-title" style={{ margin: 0, paddingLeft: 20 }}>
        {PUBLIC_BUSINESS_INFO.featuredProducts.map((product) => (
          <li key={product.url}>
            <a href={product.url} style={linkStyle}>
              {product.name} 상품 상세 보기
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
