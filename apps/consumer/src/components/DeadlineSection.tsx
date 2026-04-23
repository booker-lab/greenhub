'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Box, Text, Group, Badge } from '@mantine/core'
import type { Product } from '@greenhub/shared'

const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000

function useCountdown(deadline: string) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now()
      if (diff <= 0) { setLabel('마감'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setLabel(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  return label
}

function DeadlineCard({ product }: { product: Product }) {
  const deadline = product.groupSummary!.recruitDeadline
  const countdown = useCountdown(deadline)
  const { currentQuantity, targetQuantity } = product.groupSummary!
  const pct = Math.min((currentQuantity / targetQuantity) * 100, 100)

  return (
    <Box
      component={Link}
      href={`/products/${product.id}`}
      style={{ textDecoration: 'none', flexShrink: 0, width: 140 }}
    >
      <Box
        style={{
          aspectRatio: '4/5',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--mantine-color-gray-1)',
          position: 'relative',
          marginBottom: 6,
        }}
      >
        <img
          src={product.images?.[0] ?? '/icons/icon-192x192.png'}
          alt={product.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <Box
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.55)',
            textAlign: 'center',
          }}
        >
          <Text size="xs" fw={700} c="white" ff="monospace">{countdown}</Text>
        </Box>
      </Box>

      <Text size="xs" fw={600} c="dark" lineClamp={2} mb={4}>{product.name}</Text>

      <Box
        style={{
          height: 4,
          borderRadius: 99,
          background: 'var(--mantine-color-gray-2)',
          overflow: 'hidden',
        }}
      >
        <Box
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--mantine-color-brand-6)',
            borderRadius: 99,
          }}
        />
      </Box>
      <Text size="xs" c="brand.6" mt={2} fw={500}>{currentQuantity}/{targetQuantity}개</Text>
    </Box>
  )
}

interface DeadlineSectionProps {
  products: Product[]
}

export default function DeadlineSection({ products }: DeadlineSectionProps) {
  const soon = products.filter((p) => {
    const dl = p.groupSummary?.recruitDeadline
    if (!dl) return false
    const diff = new Date(dl).getTime() - Date.now()
    return diff > 0 && diff < DEADLINE_WINDOW_MS
  })

  if (soon.length === 0) return null

  return (
    <Box mb="xl">
      <Group justify="space-between" mb="sm">
        <Group gap={6}>
          <Text fw={700} size="sm" c="dark">🔥 마감 임박</Text>
          <Badge variant="filled" color="red" size="xs">{soon.length}</Badge>
        </Group>
      </Group>

      <Box
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {soon.map((p) => (
          <DeadlineCard key={p.id} product={p} />
        ))}
      </Box>
    </Box>
  )
}
