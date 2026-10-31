'use client';

import type { SavedAddress } from '@greenhub/shared';
import { AlertDescription, Alert as UiAlert } from '@greenhub/ui/components/alert';
import { Badge as UiBadge } from '@greenhub/ui/components/badge';
import { Button as UiButton } from '@greenhub/ui/components/button';
// 배송지 추가·수정 창은 공용 Dialog의 초점 가두기·aria-modal 수정이 들어온 뒤 바꾼다(그때까지 Mantine Modal).
import { Alert, Button, Modal, Stack, Text, TextInput } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import type { AddressFormData } from '@/hooks/useAddresses';
import { useAddresses } from '@/hooks/useAddresses';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 16)·Group(gap xs 10)·Stack·Paper(md 16, radius lg 16,
// withBorder gray-3)·Text(p, 줄 높이 1.55)·Badge xs light·Button xs outline gray·red·white red·Button sm·md와 같은 값.
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT_STYLE = { fontSize: 'var(--font-size-sm)' } as const;
const DISABLED_TEXT_STYLE = {
  color: 'var(--color-text-disabled)',
  fontSize: 'var(--font-size-sm)',
} as const;

const EMPTY_FORM: AddressFormData = { label: '', address: '', addressDetail: '', zipCode: '' };

function AddressCard({
  addr,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  addr: SavedAddress;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-solid border-[#dee2e6] bg-white p-4">
      <div className="mb-2.5 flex flex-row flex-wrap items-start justify-between gap-4">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mb-1 flex flex-row flex-wrap items-center justify-start gap-2.5">
            <p
              className={TEXT}
              style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}
            >
              {addr.label}
            </p>
            {addr.isDefault && (
              <UiBadge size="xs" variant="light">
                기본
              </UiBadge>
            )}
          </div>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {addr.address}
            {addr.addressDetail ? ` ${addr.addressDetail}` : ''}
          </p>
          <p
            className={`${TEXT} mt-0.5`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {addr.zipCode}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-row flex-wrap items-center justify-start gap-2.5">
        {!addr.isDefault && (
          <UiButton type="button" size="xs" variant="outline-gray" onClick={onSetDefault}>
            기본으로 설정
          </UiButton>
        )}
        <UiButton type="button" size="xs" variant="outline-gray" onClick={onEdit}>
          수정
        </UiButton>
        <UiButton type="button" size="xs" variant="outline-destructive" onClick={onDelete}>
          삭제
        </UiButton>
      </div>
    </div>
  );
}

function AddressFormModal({
  opened,
  initial,
  onSave,
  onClose,
}: {
  opened: boolean;
  initial: AddressFormData;
  onSave: (data: AddressFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AddressFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function set(key: keyof AddressFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim() || !form.address.trim() || !form.zipCode.trim()) {
      setFieldError('이름, 주소, 우편번호는 필수입니다.');
      return;
    }
    setSaving(true);
    setFieldError(null);
    try {
      await onSave(form);
      onClose();
    } catch (e: unknown) {
      setFieldError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initial.label ? '배송지 수정' : '배송지 추가'}
      radius="md"
      styles={{ title: { fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' } }}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="이름 *"
            placeholder="예: 집, 회사"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            radius="md"
          />
          <TextInput
            label="우편번호 *"
            placeholder="예: 06232"
            value={form.zipCode}
            onChange={(e) => set('zipCode', e.target.value)}
            radius="md"
          />
          <TextInput
            label="주소 *"
            placeholder="예: 서울 강남구 테헤란로 152"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            radius="md"
          />
          <TextInput
            label="상세 주소"
            placeholder="예: 5층 502호"
            value={form.addressDetail}
            onChange={(e) => set('addressDetail', e.target.value)}
            radius="md"
          />

          {fieldError && (
            <Alert color="red" variant="light" p="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>{fieldError}</Text>
            </Alert>
          )}

          <Button type="submit" fullWidth color="brand" radius="xl" loading={saving} mt="xs">
            저장
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export default function AddressesClient() {
  const { status } = useSession();
  const router = useRouter();
  const {
    addresses,
    loading,
    error,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    refetch,
  } = useAddresses();

  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; addr: SavedAddress } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  async function handleDelete(id: string) {
    if (!confirm('이 배송지를 삭제할까요?')) return;
    setActionError(null);
    try {
      await deleteAddress(id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.');
    }
  }

  async function handleSetDefault(id: string) {
    setActionError(null);
    try {
      await setDefaultAddress(id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    }
  }

  function getInitialForm(addr?: SavedAddress): AddressFormData {
    if (!addr) return EMPTY_FORM;
    return {
      label: addr.label,
      address: addr.address,
      addressDetail: addr.addressDetail,
      zipCode: addr.zipCode,
    };
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-20">
      <div className="mb-5 flex flex-row flex-wrap items-center justify-start gap-2.5">
        <UiButton
          type="button"
          variant="ghost"
          className="ps-0 hover:bg-transparent"
          style={{ color: 'var(--color-text)' }}
          onClick={() => router.back()}
        >
          <ChevronLeft size={20} className="size-5" />
        </UiButton>
        <p
          className={TEXT}
          style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
        >
          배송지 관리
        </p>
      </div>

      {(error || actionError) && (
        <div className="mb-4 flex flex-col items-stretch justify-start gap-2.5">
          {error && (
            <UiAlert role="alert" variant="destructive">
              <AlertDescription>
                <div className="flex flex-row flex-wrap items-center justify-between gap-3">
                  <p className={TEXT} style={SMALL_TEXT_STYLE}>
                    {error}
                  </p>
                  {/* Mantine Button white red(흰 면·red-6 글자) */}
                  <UiButton
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="bg-white text-[#fa5252] hover:bg-white"
                    onClick={() => refetch()}
                  >
                    다시 시도
                  </UiButton>
                </div>
              </AlertDescription>
            </UiAlert>
          )}
          {actionError && (
            <UiAlert role="alert" variant="destructive">
              <AlertDescription>
                <p className={TEXT} style={SMALL_TEXT_STYLE}>
                  {actionError}
                </p>
              </AlertDescription>
            </UiAlert>
          )}
        </div>
      )}

      {loading ? (
        <p className={`${TEXT} py-10 text-center`} style={DISABLED_TEXT_STYLE}>
          불러오는 중...
        </p>
      ) : error && addresses.length === 0 ? (
        <div className="flex flex-col items-center justify-start gap-3 py-12">
          <p className={`${TEXT} text-center`} style={DISABLED_TEXT_STYLE}>
            배송지 정보를 불러오지 못했습니다.
          </p>
          <UiButton type="button" onClick={() => refetch()}>
            다시 조회
          </UiButton>
        </div>
      ) : addresses.length === 0 ? (
        <p className={`${TEXT} py-12 text-center`} style={DISABLED_TEXT_STYLE}>
          등록된 배송지가 없습니다.
        </p>
      ) : (
        <div className="mb-5 flex flex-col items-stretch justify-start gap-3">
          {addresses.map((addr) => (
            <AddressCard
              key={addr.id}
              addr={addr}
              onEdit={() => setModal({ mode: 'edit', addr })}
              onDelete={() => handleDelete(addr.id)}
              onSetDefault={() => handleSetDefault(addr.id)}
            />
          ))}
        </div>
      )}

      <UiButton
        type="button"
        size="md"
        className="w-full"
        onClick={() => setModal({ mode: 'add' })}
      >
        + 배송지 추가
      </UiButton>

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
    </div>
  );
}
