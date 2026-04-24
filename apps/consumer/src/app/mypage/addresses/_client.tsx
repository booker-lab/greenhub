'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Container, Box, Group, Text, Button, Stack, Paper, Badge,
  Modal, TextInput, Alert,
} from '@mantine/core'
import { ChevronLeft } from 'lucide-react'
import { useAddresses } from '@/hooks/useAddresses'
import type { SavedAddress } from '@greenhub/shared'
import type { AddressFormData } from '@/hooks/useAddresses'

const EMPTY_FORM: AddressFormData = { label: '', address: '', addressDetail: '', zipCode: '' }

function AddressCard({
  addr,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  addr: SavedAddress
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" align="flex-start" mb="xs">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>{addr.label}</Text>
            {addr.isDefault && (
              <Badge size="xs" color="brand" variant="light">기본</Badge>
            )}
          </Group>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {addr.address}{addr.addressDetail ? ` ${addr.addressDetail}` : ''}
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mt={2}>{addr.zipCode}</Text>
        </Box>
      </Group>
      <Group gap="xs" mt="xs">
        {!addr.isDefault && (
          <Button size="xs" variant="outline" color="gray" radius="sm" onClick={onSetDefault}>
            기본으로 설정
          </Button>
        )}
        <Button size="xs" variant="outline" color="gray" radius="sm" onClick={onEdit}>수정</Button>
        <Button size="xs" variant="outline" color="red" radius="sm" onClick={onDelete}>삭제</Button>
      </Group>
    </Paper>
  )
}

function AddressFormModal({
  opened,
  initial,
  onSave,
  onClose,
}: {
  opened: boolean
  initial: AddressFormData
  onSave: (data: AddressFormData) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<AddressFormData>(initial)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  function set(key: keyof AddressFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim() || !form.address.trim() || !form.zipCode.trim()) {
      setFieldError('이름, 주소, 우편번호는 필수입니다.')
      return
    }
    setSaving(true)
    setFieldError(null)
    try {
      await onSave(form)
      onClose()
    } catch (e: unknown) {
      setFieldError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initial.label ? '배송지 수정' : '배송지 추가'}
      radius="md"
      styles={{ title: { fontWeight: 700, fontSize: 17 } }}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput label="이름 *" placeholder="예: 집, 회사" value={form.label} onChange={(e) => set('label', e.target.value)} radius="md" />
          <TextInput label="우편번호 *" placeholder="예: 06232" value={form.zipCode} onChange={(e) => set('zipCode', e.target.value)} radius="md" />
          <TextInput label="주소 *" placeholder="예: 서울 강남구 테헤란로 152" value={form.address} onChange={(e) => set('address', e.target.value)} radius="md" />
          <TextInput label="상세 주소" placeholder="예: 5층 502호" value={form.addressDetail} onChange={(e) => set('addressDetail', e.target.value)} radius="md" />

          {fieldError && (
            <Alert color="red" variant="light" p="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>{fieldError}</Text>
            </Alert>
          )}

          <Button type="submit" fullWidth color="brand" radius="md" loading={saving} mt="xs">
            저장
          </Button>
        </Stack>
      </form>
    </Modal>
  )
}

export default function AddressesClient() {
  const { status } = useSession()
  const router = useRouter()
  const { addresses, loading, error, addAddress, updateAddress, deleteAddress, setDefaultAddress } =
    useAddresses()

  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; addr: SavedAddress } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  async function handleDelete(id: string) {
    if (!confirm('이 배송지를 삭제할까요?')) return
    setActionError(null)
    try {
      await deleteAddress(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    }
  }

  async function handleSetDefault(id: string) {
    setActionError(null)
    try {
      await setDefaultAddress(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    }
  }

  function getInitialForm(addr?: SavedAddress): AddressFormData {
    if (!addr) return EMPTY_FORM
    return { label: addr.label, address: addr.address, addressDetail: addr.addressDetail, zipCode: addr.zipCode }
  }

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <Group gap="xs" mb="lg">
        <Button variant="transparent" style={{ color: 'var(--color-text)' }} pl={0} onClick={() => router.back()}>
          <ChevronLeft size={20} />
        </Button>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}>배송지 관리</Text>
      </Group>

      {(error || actionError) && (
        <Alert color="red" variant="light" mb="md">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error ?? actionError}</Text>
        </Alert>
      )}

      {loading ? (
        <Text ta="center" style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }} py={40}>불러오는 중...</Text>
      ) : addresses.length === 0 ? (
        <Text ta="center" style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }} py={48}>등록된 배송지가 없습니다.</Text>
      ) : (
        <Stack gap="sm" mb="lg">
          {addresses.map((addr) => (
            <AddressCard
              key={addr.id}
              addr={addr}
              onEdit={() => setModal({ mode: 'edit', addr })}
              onDelete={() => handleDelete(addr.id)}
              onSetDefault={() => handleSetDefault(addr.id)}
            />
          ))}
        </Stack>
      )}

      <Button fullWidth color="brand" radius="md" size="md" onClick={() => setModal({ mode: 'add' })}>
        + 배송지 추가
      </Button>

      <AddressFormModal
        opened={modal !== null}
        initial={getInitialForm(modal?.mode === 'edit' ? modal.addr : undefined)}
        onSave={
          modal?.mode === 'add'
            ? addAddress
            : (data) => updateAddress((modal as { mode: 'edit'; addr: SavedAddress }).addr.id, data)
        }
        onClose={() => setModal(null)}
      />
    </Container>
  )
}
