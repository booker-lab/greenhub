'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { apiFetch } from '@/lib/api'
import {
  Box,
  Button,
  Container,
  Divider,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'

export default function OnboardingPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    ceoName: '',
    phone: '',
    address: '',
    businessNumber: '',
    logoUrl: '',
  })

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('JPG, PNG, WebP 파일만 업로드 가능합니다.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('로고 파일 크기는 2MB 이하만 가능합니다.')
      return
    }

    setLogoUploading(true)
    setError('')
    try {
      const storageRef = ref(storage, `logos/${session?.user.id ?? 'unknown'}_${Date.now()}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      setLogoPreview(url)
      setForm((prev) => ({ ...prev, logoUrl: url }))
    } catch {
      setError('로고 업로드에 실패했습니다. 다시 시도해주세요.')
    } finally {
      setLogoUploading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target
    if (name === 'phone') {
      const digits = value.replace(/\D/g, '').slice(0, 11)
      let formatted = digits
      if (digits.length > 7) formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
      else if (digits.length > 3) formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`
      setForm((prev) => ({ ...prev, phone: formatted }))
      return
    }
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.user.storeId && !form.name) {
      setError('상호명을 입력해주세요.')
      return
    }
    setError('')
    setLoading(true)

    const storeId = session?.user.storeId
    const token = session?.user.accessToken
    if (!token) {
      setError('로그인 정보를 확인해주세요.')
      setLoading(false)
      return
    }

    const body = JSON.stringify({
      name: form.name,
      ceoName: form.ceoName,
      phone: form.phone,
      address: form.address,
      businessNumber: form.businessNumber || undefined,
      logoUrl: form.logoUrl || undefined,
    })

    let res: Response
    if (!storeId) {
      res = await apiFetch('/stores', token, { method: 'POST', body })
      if (res.ok) {
        const data = await res.json()
        await update({ storeId: data.storeId })
      }
    } else {
      res = await apiFetch(`/stores/${storeId}`, token, { method: 'PATCH', body })
    }

    setLoading(false)

    if (!res.ok) {
      setError('저장에 실패했습니다. 다시 시도해주세요.')
      return
    }

    router.push('/orders')
  }

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--green-bg)', padding: '32px 16px' }}
    >
      <Container size="xs">
        <Stack align="center" gap="xs" mb="xl">
          <Title order={2} fz="xl">사업자 정보 등록</Title>
          <Text size="sm" c="dimmed">서비스 시작 전 한 번만 입력합니다</Text>
        </Stack>

        <Paper radius="lg" shadow="sm" p="lg">
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              {/* 로고 업로드 */}
              <Stack align="center" gap="xs" pb="xs">
                <Box
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    border: '2px dashed var(--mantine-color-gray-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    backgroundColor: 'var(--mantine-color-gray-0)',
                  }}
                >
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="로고 미리보기" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Text fz={24} c="gray.3">🏪</Text>
                  )}
                </Box>
                <label style={{ cursor: 'pointer' }}>
                  <Text size="sm" c="var(--green-primary)" fw={500}>
                    {logoUploading ? '업로드 중...' : '로고 사진 선택'}
                  </Text>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                    disabled={logoUploading}
                  />
                </label>
                <Text size="xs" c="dimmed">선택 사항 · JPG, PNG, WebP 권장</Text>
              </Stack>

              <Divider />

              <TextInput
                label={<>상호명 <Text component="span" c="red">*</Text></>}
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="예: 디어 오키드"
                radius="xl"
              />

              <TextInput
                label={<>대표자명 <Text component="span" c="red">*</Text></>}
                name="ceoName"
                value={form.ceoName}
                onChange={handleChange}
                required
                placeholder="예: 홍길동"
                radius="xl"
              />

              <TextInput
                label={<>연락처 <Text component="span" c="red">*</Text></>}
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                placeholder="010-0000-0000"
                radius="xl"
              />

              <TextInput
                label={<>소재지 <Text component="span" c="red">*</Text></>}
                name="address"
                value={form.address}
                onChange={handleChange}
                required
                placeholder="사업장 주소"
                radius="xl"
              />

              <Divider />

              <TextInput
                label={<>사업자등록번호 <Text component="span" c="dimmed" fw={400}>(선택)</Text></>}
                name="businessNumber"
                value={form.businessNumber}
                onChange={handleChange}
                placeholder="000-00-00000"
                radius="xl"
              />

              {error && (
                <Text size="xs" c="red" ta="center">{error}</Text>
              )}

              <Button
                type="submit"
                disabled={loading}
                fullWidth
                size="md"
                radius="xl"
                mt="xs"
                style={{ backgroundColor: 'var(--green-primary)' }}
              >
                {loading ? '저장 중...' : '저장 후 시작하기'}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  )
}
