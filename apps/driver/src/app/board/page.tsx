'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Loader, Box } from '@mantine/core';

const BoardClient = dynamic(() => import('./_client'), { ssr: false });

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
          }}
        >
          <Loader color="brand" />
        </Box>
      }
    >
      <BoardClient />
    </Suspense>
  );
}
