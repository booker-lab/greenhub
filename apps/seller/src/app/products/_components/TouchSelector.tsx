'use client'

import { Badge, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'

const COLOR_OPTIONS = [
  '레드', '핑크', '화이트', '옐로우', '오렌지', '퍼플',
  '블루', '그린', '무늬', '브라운', '베이지', '블랙', '그레이',
] as const

const FRAGRANCE_OPTIONS = [
  { value: 'none', label: '없음', icon: '🚫' },
  { value: 'light', label: '은은', icon: '🌸' },
  { value: 'strong', label: '진함', icon: '💐' },
] as const

const BLOOM_OPTIONS = [
  { value: 'bud', label: '봉오리', icon: '🌱' },
  { value: 'half', label: '반개화', icon: '🌷' },
  { value: 'full', label: '활짝', icon: '🌺' },
] as const

export interface SelectionForm {
  colors: string[]
  fragrance: 'none' | 'light' | 'strong'
  bloomCondition: 'bud' | 'half' | 'full'
  bundleUnit: string
}

interface Props {
  value: SelectionForm
  onChange: (v: SelectionForm) => void
}

const activeStyle = {
  backgroundColor: 'var(--green-primary)',
  borderColor: 'var(--green-primary)',
  color: 'white',
}

export default function TouchSelector({ value, onChange }: Props) {
  function set<K extends keyof SelectionForm>(key: K, val: SelectionForm[K]) {
    onChange({ ...value, [key]: val })
  }

  function toggleColor(color: string) {
    const colors = value.colors.includes(color)
      ? value.colors.filter((c) => c !== color)
      : [...value.colors, color]
    set('colors', colors)
  }

  return (
    <Stack gap="sm">
      <Paper radius="lg" shadow="xs" p="md">
        <Text size="xs" fw={500} c="dimmed" mb="xs">
          색상 <Text component="span" c="gray.4">(복수 선택 가능)</Text>
        </Text>
        <Group gap="xs" style={{ flexWrap: 'wrap' }}>
          {COLOR_OPTIONS.map((color) => (
            <Badge
              key={color}
              component="button"
              onClick={() => toggleColor(color)}
              radius="xl"
              variant={value.colors.includes(color) ? 'filled' : 'outline'}
              color="gray"
              style={{
                cursor: 'pointer',
                backgroundColor: value.colors.includes(color) ? 'var(--green-bg)' : undefined,
                color: value.colors.includes(color) ? 'var(--green-primary)' : undefined,
                borderColor: value.colors.includes(color) ? 'var(--green-primary)' : undefined,
              }}
            >
              {color}
            </Badge>
          ))}
        </Group>
      </Paper>

      <Paper radius="lg" shadow="xs" p="md">
        <Text size="xs" fw={500} c="dimmed" mb="xs">향기</Text>
        <Group gap="xs">
          {FRAGRANCE_OPTIONS.map(({ value: v, label, icon }) => (
            <Button
              key={v}
              onClick={() => set('fragrance', v as SelectionForm['fragrance'])}
              flex={1}
              size="md"
              radius="xl"
              variant="outline"
              color="gray"
              style={value.fragrance === v ? activeStyle : {}}
            >
              {icon} {label}
            </Button>
          ))}
        </Group>
      </Paper>

      <Paper radius="lg" shadow="xs" p="md">
        <Text size="xs" fw={500} c="dimmed" mb="xs">개화 상태</Text>
        <Group gap="xs">
          {BLOOM_OPTIONS.map(({ value: v, label, icon }) => (
            <Button
              key={v}
              onClick={() => set('bloomCondition', v as SelectionForm['bloomCondition'])}
              flex={1}
              size="md"
              radius="xl"
              variant="outline"
              color="gray"
              style={value.bloomCondition === v ? activeStyle : {}}
            >
              {icon} {label}
            </Button>
          ))}
        </Group>
      </Paper>

      <Paper radius="lg" shadow="xs" p="md">
        <Text size="xs" fw={500} c="dimmed" mb="xs">판매 단위</Text>
        <TextInput
          placeholder="예: 1분, 3묶음, 1박스"
          value={value.bundleUnit}
          onChange={(e) => set('bundleUnit', e.target.value)}
          size="md"
          radius="xl"
        />
      </Paper>
    </Stack>
  )
}
