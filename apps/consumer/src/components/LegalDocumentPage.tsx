import Link from 'next/link';
import type { ReactNode } from 'react';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

type LegalDocumentPageProps = {
  children: ReactNode;
  description: string;
  effectiveDate: string;
  title: string;
};

const linkStyle = {
  alignItems: 'center',
  color: 'var(--color-primary)',
  display: 'inline-flex',
  fontWeight: 'var(--fw-semibold)',
  minHeight: 'var(--touch-target)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const;

export default function LegalDocumentPage({
  children,
  description,
  effectiveDate,
  title,
}: LegalDocumentPageProps) {
  return (
    <main
      style={{
        margin: '0 auto',
        maxWidth: 760,
        padding: '24px 16px 0',
        paddingBottom: 'calc(112px + env(safe-area-inset-bottom))',
      }}
    >
      <Link href="/" style={linkStyle}>
        ← {PUBLIC_BUSINESS_INFO.brand} 홈
      </Link>

      <article
        style={{
          color: 'var(--color-text)',
          overflowWrap: 'anywhere',
        }}
      >
        <header
          style={{
            borderBottom: 'var(--border)',
            marginBottom: 28,
            padding: '20px 0 24px',
          }}
        >
          <p
            style={{
              color: 'var(--color-primary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-semibold)',
              margin: '0 0 8px',
            }}
          >
            {PUBLIC_BUSINESS_INFO.brand} 법적 고지
          </p>
          <h1
            style={{
              fontSize: 'clamp(1.75rem, 7vw, 2.25rem)',
              letterSpacing: '-0.03em',
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            {title}
          </h1>
          <p
            style={{
              color: 'var(--color-text-secondary)',
              lineHeight: 1.65,
              margin: '14px 0 0',
            }}
          >
            {description}
          </p>
          <dl
            style={{
              display: 'grid',
              fontSize: 'var(--font-size-sm)',
              gap: 6,
              gridTemplateColumns: 'max-content minmax(0, 1fr)',
              margin: '18px 0 0',
            }}
          >
            <dt style={{ color: 'var(--color-text-secondary)' }}>운영자</dt>
            <dd style={{ margin: 0 }}>{PUBLIC_BUSINESS_INFO.businessName}</dd>
            <dt style={{ color: 'var(--color-text-secondary)' }}>시행일</dt>
            <dd style={{ margin: 0 }}>{effectiveDate}</dd>
          </dl>
        </header>

        <div
          style={{
            fontSize: 'var(--font-size-md)',
            lineHeight: 1.75,
          }}
        >
          {children}
        </div>
      </article>

      <nav
        aria-label="법적 문서"
        style={{
          borderTop: 'var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 20px',
          marginTop: 36,
          paddingTop: 18,
        }}
      >
        <Link href="/privacy" style={linkStyle}>
          개인정보처리방침
        </Link>
        <Link href="/terms" style={linkStyle}>
          이용약관
        </Link>
      </nav>
    </main>
  );
}
