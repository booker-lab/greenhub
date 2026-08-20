import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

const channelLinkStyle = {
  alignItems: 'center',
  border: 'var(--border)',
  borderRadius: 'var(--radius-full)',
  color: 'var(--color-primary)',
  display: 'inline-flex',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  minHeight: 'var(--touch-target)',
  padding: '0 16px',
  textDecoration: 'none',
} as const;

const productLinkStyle = {
  background: 'var(--color-surface-muted)',
  border: 'var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text)',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  gap: 8,
  height: '100%',
  justifyContent: 'space-between',
  minHeight: 84,
  minWidth: 0,
  padding: 14,
  textDecoration: 'none',
} as const;

export default function BusinessRelationshipNotice() {
  return (
    <section
      aria-labelledby="business-relationship-title"
      style={{
        borderBottom: 'var(--border)',
        marginBottom: 24,
        padding: '4px 0 24px',
      }}
    >
      <p
        style={{
          color: 'var(--color-primary)',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--fw-bold)',
          margin: '0 0 8px',
        }}
      >
        그린러브 운영 안내
      </p>
      <h2
        id="business-relationship-title"
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--fw-bold)',
          lineHeight: 1.35,
          margin: 0,
        }}
      >
        {PUBLIC_BUSINESS_INFO.relationship}
      </h2>
      <a
        href={PUBLIC_BUSINESS_INFO.kakaoChannel.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...channelLinkStyle, marginTop: 16 }}
        aria-label={`카카오톡 채널 ${PUBLIC_BUSINESS_INFO.kakaoChannel.name} 새 창에서 열기`}
      >
        공식 카카오톡 채널 ‘{PUBLIC_BUSINESS_INFO.kakaoChannel.name}’ →
      </a>
      <h3
        id="featured-products-title"
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          margin: '24px 0 10px',
        }}
      >
        그린러브 대표 판매상품
      </h3>
      <ul
        aria-labelledby="featured-products-title"
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {PUBLIC_BUSINESS_INFO.featuredProducts.map((product) => (
          <li key={product.url} style={{ minWidth: 0 }}>
            <a href={product.url} style={productLinkStyle}>
              <span>{product.name}</span>
              <span style={{ color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)' }}>
                상품 보기 →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
