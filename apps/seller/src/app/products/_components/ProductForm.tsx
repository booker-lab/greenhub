'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ImageUpload from './ImageUpload'
import GroupConfigSection from './GroupConfigSection'
import {
  ActionIcon, Badge, Box, Button, Container, Group,
  Paper, Stack, Text, Textarea, TextInput, Title, UnstyledButton,
} from '@mantine/core'

const CATEGORIES = [
  { value: 'cut_flower', label: '절화' },
  { value: 'orchid', label: '난' },
  { value: 'foliage', label: '관엽' },
] as const

const COLOR_OPTIONS = [
  '레드', '핑크', '화이트', '옐로우', '오렌지', '퍼플',
  '블루', '그린', '무늬', '브라운', '베이지', '블랙', '그레이',
] as const

const DELIVERY_SIZES = [
  { value: 'small', label: '소형' },
  { value: 'medium', label: '중형' },
  { value: 'large', label: '대형' },
] as const

interface GroupConfigForm {
  minParticipants: string
  maxParticipants: string
  recruitDeadline: string
  groupDeliveryDate: string
  groupDeliveryMethod: 'direct' | 'parcel'
}

export interface ProductFormData {
  name: string
  category: string
  colors: string[]
  deliverySize: string
  price: string
  description: string
  saleType: 'normal' | 'group'
  groupConfig: GroupConfigForm
  images: string[]
}

export interface ProductFormProps {
  mode: 'create' | 'edit'
  productId?: string
  storeId: string
  token: string
  initialData?: Partial<ProductFormData>
  onSuccess: () => void
}

function defaultForm(): ProductFormData {
  return {
    name: '', category: 'cut_flower', colors: [], deliverySize: 'small',
    price: '', description: '', saleType: 'normal',
    groupConfig: { minParticipants: '2', maxParticipants: '10', recruitDeadline: '', groupDeliveryDate: '', groupDeliveryMethod: 'direct' },
    images: [],
  }
}

export default function ProductForm({ mode, productId, storeId, token, initialData, onSuccess }: ProductFormProps) {
  const router = useRouter()
  const draftKey = mode === 'create' ? 'product_draft_new' : `product_draft_${productId}`

  const [form, setForm] = useState<ProductFormData>(() => {
    if (initialData) return { ...defaultForm(), ...initialData }
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        const def = defaultForm()
        const merged = { ...def, ...parsed, groupConfig: { ...def.groupConfig, ...(parsed.groupConfig ?? {}) } }
        // groupConfig 필드 누락 시 draft 폐기
        const g = merged.groupConfig
        const valid = typeof g.minParticipants === 'string' && typeof g.maxParticipants === 'string'
          && typeof g.recruitDeadline === 'string' && typeof g.groupDeliveryDate === 'string'
        if (!valid) { localStorage.removeItem(draftKey); return def }
        return merged
      }
    } catch {}
    return defaultForm()
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)

  useEffect(() => {
    if (initialData?.name) setForm({ ...defaultForm(), ...initialData })
  }, [initialData?.name])

  function set<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function setGroupConfig<K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) {
    setForm((prev) => ({ ...prev, groupConfig: { ...prev.groupConfig, [key]: value } }))
  }

  function toggleColor(color: string) {
    setForm((prev) => ({
      ...prev,
      colors: prev.colors.includes(color)
        ? prev.colors.filter((c) => c !== color)
        : [...prev.colors, color],
    }))
  }

  function handleDraftSave() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(form))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch {}
  }

  function handleDraftReset() {
    try { localStorage.removeItem(draftKey) } catch {}
    setForm(defaultForm())
    setError(null)
  }

  function validate(): string | null {
    if (!form.name.trim()) return '상품명을 입력해주세요.'
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0) return '올바른 가격을 입력해주세요.'
    if (form.colors.length === 0) return '색상을 하나 이상 선택해주세요.'
    if (form.saleType === 'group') {
      const g = form.groupConfig
      if (!g.minParticipants) return '최소 인원을 입력해주세요.'
      if (!g.maxParticipants) return '최대 인원을 입력해주세요.'
      if (!g.recruitDeadline) return '모집 마감일시를 입력해주세요.'
      if (!g.groupDeliveryDate) return '배송 예정일을 입력해주세요.'
      if (Number(g.minParticipants) < 2)
        return '최소 인원은 2명 이상이어야 합니다.'
      if (Number(g.minParticipants) > Number(g.maxParticipants))
        return '최소 인원은 최대 인원보다 클 수 없습니다.'
      if (new Date(g.recruitDeadline) <= new Date())
        return '모집 마감일시는 현재 시각 이후여야 합니다.'
      if (new Date(g.groupDeliveryDate) <= new Date(g.recruitDeadline))
        return '배송 예정일은 모집 마감일 이후여야 합니다.'
    }
    return null
  }

  async function handleSubmit() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setSubmitting(true)
    setError(null)
    const body: Record<string, unknown> = {
      name: form.name.trim(), description: form.description.trim(), images: form.images,
      price: Number(form.price), category: form.category, colors: form.colors,
      saleType: form.saleType, deliverySize: form.deliverySize,
    }
    if (form.saleType === 'group') {
      body.groupConfig = {
        minParticipants: Number(form.groupConfig.minParticipants),
        maxParticipants: Number(form.groupConfig.maxParticipants),
        recruitDeadline: new Date(form.groupConfig.recruitDeadline).toISOString(),
        groupDeliveryDate: new Date(form.groupConfig.groupDeliveryDate).toISOString(),
        groupDeliveryMethod: form.groupConfig.groupDeliveryMethod,
        deliveryFeeDiscount: 0,
      }
    }
    try {
      const url = mode === 'create' ? `/stores/${storeId}/products` : `/stores/${storeId}/products/${productId}`
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `서버 오류 (${res.status})`)
      }
      localStorage.removeItem(draftKey)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)' }}>
      <Box component="header" style={{ backgroundColor: 'var(--mantine-color-white)', borderBottom: '1px solid var(--mantine-color-gray-1)', padding: '16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <Container size="sm">
          <Group justify="space-between">
            <Group gap="sm">
              <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 5l-7 7 7 7" />
                </svg>
              </ActionIcon>
              <Title order={3}>{mode === 'create' ? '상품 등록' : '상품 수정'}</Title>
            </Group>
            <Group gap="xs">
              <UnstyledButton onClick={handleDraftReset} style={{ fontSize: 13, color: 'var(--mantine-color-gray-4)' }}>
                초기화
              </UnstyledButton>
              <UnstyledButton onClick={handleDraftSave} style={{ fontSize: 14, fontWeight: 500, color: draftSaved ? 'var(--green-primary)' : 'var(--mantine-color-gray-6)' }}>
                {draftSaved ? '저장됨 ✓' : '임시저장'}
              </UnstyledButton>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md" pb={96}>
        <Stack gap="sm">
          <ImageUpload storeId={storeId} images={form.images} onChange={(images) => set('images', images)} onError={(msg) => setError(msg)} />

          <TextInput placeholder="상품명" value={form.name} onChange={(e) => set('name', e.target.value)} radius="xl" size="md" />

          <Paper radius="lg" shadow="xs" p="md">
            <Text size="xs" fw={500} c="dimmed" mb="xs">카테고리</Text>
            <Group gap="xs">
              {CATEGORIES.map(({ value, label }) => (
                <Button key={value} onClick={() => set('category', value)} flex={1} size="sm" radius="xl"
                  variant={form.category === value ? 'filled' : 'outline'} color="gray"
                  style={form.category === value ? { backgroundColor: 'var(--green-primary)', borderColor: 'var(--green-primary)', color: 'white' } : {}}>
                  {label}
                </Button>
              ))}
            </Group>
          </Paper>

          <Paper radius="lg" shadow="xs" p="md">
            <Text size="xs" fw={500} c="dimmed" mb="xs">
              색상 <Text component="span" c="gray.4">(복수 선택 가능)</Text>
            </Text>
            <Group gap="xs" style={{ flexWrap: 'wrap' }}>
              {COLOR_OPTIONS.map((color) => (
                <Badge key={color} component="button" onClick={() => toggleColor(color)} radius="xl"
                  variant={form.colors.includes(color) ? 'filled' : 'outline'} color="gray"
                  style={{
                    cursor: 'pointer',
                    backgroundColor: form.colors.includes(color) ? 'var(--green-bg)' : undefined,
                    color: form.colors.includes(color) ? 'var(--green-primary)' : undefined,
                    borderColor: form.colors.includes(color) ? 'var(--green-primary)' : undefined,
                  }}>
                  {color}
                </Badge>
              ))}
            </Group>
          </Paper>

          <Paper radius="lg" shadow="xs" p="md">
            <Text size="xs" fw={500} c="dimmed" mb="xs">배송 사이즈</Text>
            <Group gap="xs">
              {DELIVERY_SIZES.map(({ value, label }) => (
                <Button key={value} onClick={() => set('deliverySize', value)} flex={1} size="sm" radius="xl"
                  variant="outline" color="gray"
                  style={form.deliverySize === value ? { backgroundColor: 'var(--green-primary)', borderColor: 'var(--green-primary)', color: 'white' } : {}}>
                  {label}
                </Button>
              ))}
            </Group>
          </Paper>

          <TextInput type="number" placeholder="가격" leftSection={<Text size="sm" c="dimmed">₩</Text>}
            min={0} value={form.price} onChange={(e) => set('price', e.target.value)} radius="xl" size="md" />

          <Textarea placeholder="상품 상세 설명" value={form.description} onChange={(e) => set('description', e.target.value)} rows={4} radius="xl" />

          <Paper radius="lg" shadow="xs" p="md">
            <Text size="xs" fw={500} c="dimmed" mb="sm">판매 방식</Text>
            <Group gap="xl">
              {(['normal', 'group'] as const).map((type) => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="radio" name="saleType" checked={form.saleType === type} onChange={() => set('saleType', type)}
                    style={{ accentColor: 'var(--green-primary)', width: 16, height: 16 }} />
                  <Text size="sm" c="gray.7">{type === 'normal' ? '일반 판매' : '공동구매'}</Text>
                </label>
              ))}
            </Group>
            <GroupConfigSection visible={form.saleType === 'group'} config={form.groupConfig} setGroupConfig={setGroupConfig} />
          </Paper>

          {error && <Text size="sm" c="red" ta="center" px="xs">{error}</Text>}

          <Button onClick={handleSubmit} disabled={submitting} fullWidth size="lg" radius="xl" fw={600} mt="xs" style={{ backgroundColor: 'var(--green-primary)' }}>
            {submitting ? '처리 중...' : mode === 'create' ? '등록하기' : '저장하기'}
          </Button>
        </Stack>
      </Container>
    </Box>
  )
}
