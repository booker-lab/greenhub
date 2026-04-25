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
      <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)' }} mb={4}>판매자 메모</Text>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} mb="xs">
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
      <Text style={{ fontSize: 'var(--font-size-sm)', color: value.length >= MAX ? 'var(--color-danger)' : 'var(--color-text-disabled)' }} ta="right" mt={4}>
        {value.length} / {MAX}
      </Text>
    </Paper>
  )
}
