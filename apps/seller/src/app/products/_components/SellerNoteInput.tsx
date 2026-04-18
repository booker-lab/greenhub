'use client'

import { Paper, Text, Textarea } from '@mantine/core'

const MAX = 200

interface Props {
  value: string
  onChange: (v: string) => void
}

export default function SellerNoteInput({ value, onChange }: Props) {
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text size="xs" fw={500} c="dimmed" mb={4}>판매자 메모</Text>
      <Text size="xs" c="gray.5" mb="xs">
        이 꽃의 특별한 점, 재배 환경, 수령 팁 등을 자유롭게 적어주세요.
        AI가 이 내용을 바탕으로 상세 설명을 작성합니다.
      </Text>
      <Textarea
        placeholder="예: 직접 키운 호접란입니다. 남향 베란다에서 3년째 관리 중이며 뿌리가 튼튼합니다..."
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX))}
        minRows={5}
        radius="md"
        styles={{ input: { fontSize: 16, lineHeight: 1.6 } }}
      />
      <Text size="xs" c={value.length >= MAX ? 'red' : 'gray.4'} ta="right" mt={4}>
        {value.length} / {MAX}
      </Text>
    </Paper>
  )
}
