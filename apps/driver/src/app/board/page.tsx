import { Suspense } from 'react';
import { Spinner } from '@/components/spinner';
import BoardClient from './_client';

// 목록 화면은 서버에서도 그린다(브라우저 API는 effect 안에서만 쓴다). 화면 청크가 첫 문서의
// 스크립트와 함께 내려와 하이드레이션 직후 바로 목록을 조회한다.
export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
          }}
        >
          <Spinner />
        </div>
      }
    >
      <BoardClient />
    </Suspense>
  );
}
