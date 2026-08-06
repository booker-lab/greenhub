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
    </section>
  );
}
