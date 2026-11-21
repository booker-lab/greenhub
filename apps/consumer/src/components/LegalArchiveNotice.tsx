// 법적 문서 이전 버전 보관본 맨 위의 안내 상자(docs/specs/legal/consumer-legal-documents.md §11).
// 보관본은 당시 공개본을 글자 그대로 두고 이 상자와 메타데이터만 더한다.

type LegalArchiveNoticeProps = {
  /** "개인정보처리방침" 또는 "이용약관" */
  documentName: string;
  /** 현재 문서 경로("/privacy"·"/terms") */
  currentHref: string;
  /** 적용 기간 문장: "2026년 11월 8일부터 11월 27일까지" */
  period: string;
  /** 다음 판 시행일: "2026년 11월 28일" */
  nextEffectiveDate: string;
};

export default function LegalArchiveNotice({
  documentName,
  currentHref,
  period,
  nextEffectiveDate,
}: LegalArchiveNoticeProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 24,
        padding: 16,
      }}
    >
      <p style={{ fontWeight: 'var(--fw-bold)', margin: 0 }}>이전 버전의 {documentName}입니다.</p>
      <p style={{ margin: '4px 0 0' }}>
        {period} 적용됐습니다. {nextEffectiveDate}부터는 다음 버전이 적용되며, 지금 적용되는 내용은{' '}
        <a href={currentHref}>현재 {documentName}</a>에서 확인할 수 있습니다.
      </p>
    </div>
  );
}
