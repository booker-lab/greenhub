'use client'

import { Badge, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'

const COLOR_OPTIONS = [
  '레드', '핑크', '연핑크', '로즈',
  '화이트', '크림', '옐로우', '골드',
  '오렌지', '퍼플', '바이올렛', '연보라',
  '블루', '그린', '무늬', '브라운', '베이지', '블랙', '그레이',
] as const

const STEM_OPTIONS = [
  { value: '외대', label: '외대', desc: '1줄기' },
  { value: '쌍대', label: '쌍대', desc: '2줄기' },
  { value: '가지', label: '가지', desc: '다분지' },
  { value: '3대', label: '3대', desc: '3줄기' },
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
  stemType: '외대' | '쌍대' | '가지' | '3대'
  fragrance: 'none' | 'light' | 'strong'
  bloomCondition: 'bud' | 'half' | 'full'
  bundleUnit: string
}

interface Props {
  value: SelectionForm
  onChange: (v: SelectionForm) => void
  availableStemTypes?: string[]
}

const activeStyle = {
  backgroundColor: 'var(--green-primary)',
  borderColor: 'var(--green-primary)',
  color: 'white',
}

export default function TouchSelector({ value, onChange, availableStemTypes }: Props) {
  function set<K extends keyof SelectionForm>(key: K, val: SelectionForm[K]) {
    onChange({ ...value, [key]: val })
  }

  function toggleColor(color: string) {
    const colors = value.colors.includes(color)
      ? value.colors.filter((c) => c !== color)
      : [...value.colors, color]
    set('colors', colors)
  }

  const stemOptions = availableStemTypes
    ? STEM_OPTIONS.filter((o) => availableStemTypes.includes(o.value))
    : STEM_OPTIONS

  return (
    <Stack gap="sm">
      <Paper radius="lg" shadow="xs" p="md">
        <Text size="xs" fw={500} c="dimmed" mb="xs">출하 형태</Text>
        <Group gap="xs">
          {stemOptions.map(({ value: v, label, desc }) => (
            <Button
              key={v}
              onClick={() => set('stemType', v as SelectionForm['stemType'])}
              flex={1}
              size="md"
              radius="xl"
              variant="outline"
              color="gray"
              style={value.stemType === v ? activeStyle : {}}
            >
              <Stack gap={0} align="center">
                <Text size="sm" fw={600}>{label}</Text>
                <Text size="10px" c={value.stemType === v ? 'white' : 'dimmed'}>{desc}</Text>
              </Stack>
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
