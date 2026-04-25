import { Box, Text, Title, Stack, Group, Badge, Divider, Paper, SimpleGrid } from '@mantine/core'
import type { Product, Variety } from '@greenhub/shared'

const FRAGRANCE_LABEL: Record<string, string> = {
  none: '없음', light: '은은함', strong: '진함',
}
const BLOOM_LABEL: Record<string, string> = {
  bud: '봉오리', half: '반개화', full: '활짝 핌',
}
const CARE_LABEL: Record<string, string> = {
  easy: '쉬움', normal: '보통', hard: '어려움',
}

interface Props {
  product: Product
  variety: Variety | null
}

export default function ProductInfo({ product, variety }: Props) {
  const isGroup = product.saleType === 'group'
  const headline = product.content?.headline ?? null
  const description = product.content?.description ?? product.description ?? null
  const displayColors = product.selection?.colors ?? product.colors ?? []

  const careCards = [
    product.selection?.bloomCondition
      ? { icon: '🌸', label: '개화 상태', value: BLOOM_LABEL[product.selection.bloomCondition] ?? product.selection.bloomCondition }
      : null,
    product.selection?.fragrance
      ? { icon: '💨', label: '향기', value: FRAGRANCE_LABEL[product.selection.fragrance] ?? product.selection.fragrance }
      : null,
    product.selection?.careLevel
      ? { icon: '⭐', label: '관리 난이도', value: CARE_LABEL[product.selection.careLevel] ?? product.selection.careLevel }
      : null,
  ].filter((c): c is { icon: string; label: string; value: string } => c !== null)

  return (
    <Stack gap={0} px="md" pt="lg">
      {headline && (
        <Text mb="xs" style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)', lineHeight: 1.3 }}>
          {headline}
        </Text>
      )}

      <Stack gap="xs" mb="lg">
        <Group gap="xs">
          {isGroup && <Badge color="brand" variant="filled" size="sm">공동구매</Badge>}
          <Badge color="gray" variant="light" size="sm">
            {product.category === 'cut_flower' ? '절화' : product.category === 'orchid' ? '난' : '관엽'}
          </Badge>
        </Group>
        <Title order={2} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{product.name}</Title>
        <Text style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{product.price.toLocaleString()}원</Text>
      </Stack>

      <Divider mb="lg" />

      {careCards.length > 0 && (
        <Paper radius="md" p="md" mb="md" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
          <SimpleGrid cols={careCards.length} spacing="xs">
            {careCards.map(({ icon, label, value }) => (
              <Stack key={label} gap={4} align="center">
                <Text size="xl" style={{ lineHeight: 1 }}>{icon}</Text>
                <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{value}</Text>
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>{label}</Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Paper>
      )}

      {product.varietyId && (
        <Box mb="lg">
          <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }} mb="sm">상품 정보</Text>
          <Stack gap={6}>
            {([
              variety ? ['품종', variety.name] : null,
              displayColors.length > 0 ? ['색상', displayColors.join(' · ')] : null,
              variety ? ['추천 관상 기간', variety.bloomDuration] : null,
              product.selection?.bundleUnit ? ['판매 단위', product.selection.bundleUnit] : null,
              product.selection?.stemType ? ['출하 형태', product.selection.stemType] : null,
            ] as ([string, string] | null)[])
              .filter((r): r is [string, string] => r !== null)
              .map(([label, value]) => (
                <Group key={label} justify="space-between" style={{ borderBottom: '1px solid var(--color-surface-muted)', paddingBottom: 6 }}>
                  <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{label}</Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text)' }}>{value}</Text>
                </Group>
              ))}
          </Stack>
        </Box>
      )}

      {description && (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line' }} mb="lg">
          {description}
        </Text>
      )}

      {(product.images?.length ?? 0) > 0 && (
        <Box mx={-16} mb="lg">
          {product.images!.map((src, i) => (
            <img key={i} src={src} alt={`${product.name} 상세 ${i + 1}`} loading="lazy" style={{ width: '100%', display: 'block' }} />
          ))}
        </Box>
      )}

      {displayColors.length > 0 && (
        <Group gap="xs" mb="lg" style={{ flexWrap: 'wrap' }}>
          {displayColors.map((color) => (
            <Badge key={color} variant="outline" color="gray" radius="xl" size="sm">{color}</Badge>
          ))}
        </Group>
      )}
    </Stack>
  )
}
