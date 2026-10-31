'use client';

import type { SavedAddress } from '@greenhub/shared';
import { AlertDescription, Alert as UiAlert } from '@greenhub/ui/components/alert';
import { Badge as UiBadge } from '@greenhub/ui/components/badge';
import { Button as UiButton } from '@greenhub/ui/components/button';
import { CloseIcon, closeButtonClassName } from '@greenhub/ui/components/close-button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useId, useState } from 'react';
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

  // ① 외형 유지: Mantine Modal(md 440px, 위에서 시작, radius md 8px, 제목 굵게·lg)·Stack(gap sm 12px)·
  // TextInput(radius md 8px)·Alert(red light, 안쪽 xs 10px)·Button(fullWidth, 위 여백 xs 10px)과 같은 값.
  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* 하단 탭(z 100) 위를 덮도록 Mantine Modal과 같은 z 200을 쓴다. DialogContent는 오버레이·뷰포트 z가 50으로
          고정이라, 같은 구조·클래스(위에서 시작하는 뷰포트, 닫기 버튼을 본문 앞에)로 풀어서 z만 바꾼다(기사 배송 보류 창과 같은 방식).
          창 본체는 DialogContent와 같은 DialogPopup이라 Tab 순회가 창 안에서만 돌고 aria-modal이 붙는다. */}
      <DialogPortal>
        <DialogOverlay className="z-[200]" />
        <div
          data-slot="dialog-viewport"
          className="pointer-events-none fixed inset-0 z-[200] flex items-start justify-center px-[5vw] py-[5dvh]"
        >
          <DialogPopup
            data-slot="dialog-content"
            className="pointer-events-auto relative flex max-h-[90dvh] w-[440px] max-w-full flex-col overflow-y-auto rounded-[8px] bg-background text-black shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none will-change-[opacity] duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <DialogClose
              data-slot="dialog-close"
              aria-label="닫기"
              className={closeButtonClassName}
            >
              <CloseIcon />
            </DialogClose>
            <DialogHeader className="rounded-t-[8px]">
              <DialogTitle
                style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
              >
                {initial.label ? '배송지 수정' : '배송지 추가'}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <form onSubmit={handleSubmit}>
                <div className="flex flex-col gap-3">
                  <AddressField
                    label="이름 *"
                    placeholder="예: 집, 회사"
                    value={form.label}
                    onChange={(value) => set('label', value)}
                  />
                  <AddressField
                    label="우편번호 *"
                    placeholder="예: 06232"
                    value={form.zipCode}
                    onChange={(value) => set('zipCode', value)}
                  />
                  <AddressField
                    label="주소 *"
                    placeholder="예: 서울 강남구 테헤란로 152"
                    value={form.address}
                    onChange={(value) => set('address', value)}
                  />
                  <AddressField
                    label="상세 주소"
                    placeholder="예: 5층 502호"
                    value={form.addressDetail}
                    onChange={(value) => set('addressDetail', value)}
                  />

                  {fieldError && (
                    <UiAlert role="alert" variant="destructive" className="p-2.5">
                      <AlertDescription>
                        <p className={TEXT} style={SMALL_TEXT_STYLE}>
                          {fieldError}
                        </p>
                      </AlertDescription>
                    </UiAlert>
                  )}

                  <LoadingButton type="submit" className="mt-2.5 w-full" loading={saving}>
                    저장
                  </LoadingButton>
                </div>
              </form>
            </DialogBody>
          </DialogPopup>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

// Mantine TextInput(label + 입력칸)과 같은 구조: 감싸는 상자는 역할 없는 div, 라벨은 inline-block.
function AddressField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} className="inline-block">
        {label}
      </FieldLabel>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[8px]"
      />
    </div>
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
