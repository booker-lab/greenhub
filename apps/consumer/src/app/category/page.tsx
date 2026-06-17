import { Box, Container, SimpleGrid, Skeleton } from '@mantine/core';
import { Suspense } from 'react';
import CategoryClient from './_client';

const SKELETON_KEYS = [
  'category-route-skeleton-1',
  'category-route-skeleton-2',
  'category-route-skeleton-3',
  'category-route-skeleton-4',
];

function CategoryFallback() {
  return (
    <Container size="sm" pb={96}>
      <Box px="md" pt="lg" pb="md">
        <Skeleton height={32} width={120} radius="sm" />
      </Box>
      <Box px="md">
        <SimpleGrid cols={2} spacing="sm">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={260} radius="md" />
          ))}
        </SimpleGrid>
      </Box>
    </Container>
  );
}

export default function CategoryPage() {
  return (
    <Suspense fallback={<CategoryFallback />}>
      <CategoryClient />
    </Suspense>
  );
}
