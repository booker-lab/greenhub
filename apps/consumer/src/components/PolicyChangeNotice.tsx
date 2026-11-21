'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// 개인정보처리방침 2026-11-28 개정의 시행 전 안내(docs/specs/legal/consumer-legal-documents.md §11).
// 홈은 빌드 때 정적으로 만들어지므로 서버에서 날짜를 판단하면 빌드 시각에 굳는다. 그래서 브라우저 시각으로
// 시행 전(한국 시간 2026-11-27까지)일 때만 보인다. 첫 HTML에는 없고, 시행 뒤에는 다시 배포하지 않아도 사라진다.
const NOTICE_END_MS = Date.parse('2026-11-28T00:00:00+09:00');

const noticeLinkStyle = {
  alignItems: 'center',
  color: 'var(--color-text)',
  display: 'inline-flex',
  fontSize: 'var(--font-size-sm)',
  minHeight: 'var(--touch-target)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const;

export default function PolicyChangeNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(Date.now() < NOTICE_END_MS);
  }, []);

  if (!visible) return null;

  return (
    <Link href="/privacy#changes" style={noticeLinkStyle}>
      개인정보처리방침 개정(11월 28일 시행)
    </Link>
  );
}
