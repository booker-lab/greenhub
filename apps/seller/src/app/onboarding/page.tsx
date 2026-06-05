'use client';

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
} from '@mantine/core';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ApiError, apiJson } from '@/lib/api';
import { getFirebaseStorage } from '@/lib/firebase';

export default function OnboardingPage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');
  const [error, setError] = useState('');
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeLoadError, setStoreLoadError] = useState('');

  const [form, setForm] = useState({
    name: '',
    ceoName: '',
    phone: '',
    address: '',
    businessNumber: '',
    logoUrl: '',
  });

  useEffect(() => {
    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (!storeId || !token) return;
    setStoreLoading(true);
    setStoreLoadError('');
    apiJson<{
      name?: string;
      ceoName?: string;
      phone?: string;
      address?: string;
      businessNumber?: string;
      logoUrl?: string;
    }>(`/stores/${storeId}`, token)
      .then((data) => {
        setForm({
          name: data.name ?? '',
          ceoName: data.ceoName ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          businessNumber: data.businessNumber ?? '',
          logoUrl: data.logoUrl ?? '',
        });
        if (data.logoUrl) setLogoPreview(data.logoUrl);
      })
      .catch((e) => {
        setStoreLoadError(
          e instanceof ApiError
            ? `사업자 정보를 불러오지 못했습니다. ${e.message}`
            : '사업자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
      })
      .finally(() => {
        setStoreLoading(false);
      });
  }, [session?.user.storeId, session?.user.accessToken]);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('JPG, PNG, WebP 파일만 업로드 가능합니다.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('로고 파일 크기는 2MB 이하만 가능합니다.');
      return;
    }

    setLogoUploading(true);
    setError('');
    try {
      const storageRef = ref(
        getFirebaseStorage(),
        `logos/${session?.user.id ?? 'unknown'}_${Date.now()}`,
      );
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setLogoPreview(url);
      setForm((prev) => ({ ...prev, logoUrl: url }));
    } catch {
      setError('로고 업로드에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLogoUploading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    if (name === 'phone') {
      const digits = value.replace(/\D/g, '').slice(0, 11);
      let formatted = digits;
      if (digits.length > 7)
        formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
      else if (digits.length > 3) formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      setForm((prev) => ({ ...prev, phone: formatted }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user.storeId && !form.name) {
      setError('상호명을 입력해주세요.');
      return;
    }
    setError('');
    setLoading(true);

    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (storeId && (storeLoading || storeLoadError)) {
      setError(storeLoadError || '사업자 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!token) {
      setError('로그인 정보를 확인해주세요.');
      setLoading(false);
      return;
    }

    const body = JSON.stringify({
      name: form.name,
      ceoName: form.ceoName,
      phone: form.phone,
      address: form.address,
      businessNumber: form.businessNumber || undefined,
      logoUrl: form.logoUrl || undefined,
    });

    try {
      if (!storeId) {
        const data = await apiJson<{ storeId: string }>('/stores', token, {
          method: 'POST',
          body,
        });
        await update({ storeId: data.storeId });
      } else {
        await apiJson(`/stores/${storeId}`, token, { method: 'PATCH', body });
      }
      router.push('/orders');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)', padding: '32px 16px' }}
    >
      <Container size="xs">
        <Stack align="center" gap="xs" mb="xl">
          <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>
            사업자 정보 등록
          </Title>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            서비스 시작 전 한 번만 입력합니다
          </Text>
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
                    position: 'relative',
                    borderRadius: '50%',
                    border: '2px dashed var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    backgroundColor: 'var(--color-surface-muted)',
                  }}
                >
                  {logoPreview ? (
                    <Image
                      src={logoPreview}
                      alt="로고 미리보기"
                      fill
                      sizes="80px"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <Text
                      style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-border)' }}
                    >
                      🏪
                    </Text>
                  )}
                </Box>
                <label style={{ cursor: 'pointer' }}>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-primary)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
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
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  선택 사항 · JPG, PNG, WebP 권장
                </Text>
              </Stack>

              <Divider />

              <TextInput
                label={
                  <>
                    상호명{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="예: 디어 오키드"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    대표자명{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="ceoName"
                value={form.ceoName}
                onChange={handleChange}
                required
                placeholder="예: 홍길동"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    연락처{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                placeholder="010-0000-0000"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    소재지{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="address"
                value={form.address}
                onChange={handleChange}
                required
                placeholder="사업장 주소"
                radius="xl"
              />

              <Divider />

              <TextInput
                label={
                  <>
                    사업자등록번호{' '}
                    <Text
                      component="span"
                      style={{ color: 'var(--color-text-disabled)', fontWeight: 400 }}
                    >
                      (선택)
                    </Text>
                  </>
                }
                name="businessNumber"
                value={form.businessNumber}
                onChange={handleChange}
                placeholder="000-00-00000"
                radius="xl"
              />

              {error && (
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  ta="center"
                >
                  {error}
                </Text>
              )}

              {storeLoadError && !error && (
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  ta="center"
                >
                  {storeLoadError}
                </Text>
              )}

              <Button
                type="submit"
                disabled={loading || storeLoading || Boolean(storeLoadError)}
                fullWidth
                size="md"
                radius="xl"
                mt="xs"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {loading
                  ? '저장 중...'
                  : storeLoading
                    ? '기존 정보 불러오는 중...'
                    : '저장 후 시작하기'}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}
