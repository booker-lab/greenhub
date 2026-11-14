'use client';

import type { SavedAddress } from '@greenhub/shared';
import { AlertDescription, Alert as UiAlert } from '@greenhub/ui/components/alert';
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
import { cn } from '@greenhub/ui/lib/utils';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useId, useState } from 'react';
import { Button as UiButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingButton } from '@/components/LoadingButton';
import type { AddressFormData } from '@/hooks/useAddresses';
import { useAddresses } from '@/hooks/useAddresses';
import { addressDeleteConfirmContent } from '@/lib/confirm-dialog-content';
import { TOUCH_HEIGHT, TOUCH_ICON } from '@/lib/touch-target';
import { MyPageBackButton } from '../_back-button';
import { currentMyPageLoginUrl } from '../_login';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 16)·Group(gap xs 10)·Stack·Paper(md 16, radius lg 16,
// withBorder gray-3)·Text(p, 줄 높이 1.55)·Badge xs light·Button xs outline gray·red·white red·Button sm·md와 같은 값.
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT_STYLE = { fontSize: 'var(--font-size-sm)' } as const;
const DISABLED_TEXT_STYLE = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
} as const;

// 창 닫기 버튼: X 그림(공용 28px 버튼의 70% = 19.6px)과 가운데 위치는 그대로 두고 눌리는 영역만 44×44px로 넓힌다.
const DIALOG_CLOSE_TOUCH = `${TOUCH_ICON} top-2 right-[3px]`;
const DIALOG_CLOSE_ICON_STYLE = { width: 19.6, height: 19.6 } as const;

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
    <div className="rounded-[16px] bg-[var(--color-surface-muted)] p-4">
      <div className="mb-2.5 flex flex-row flex-wrap items-start justify-between gap-4">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mb-1 flex flex-row flex-wrap items-center justify-start gap-2.5">
            <p
              className={TEXT}
              style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}
            >
              {addr.label}
            </p>
            {/* ② 방향(design-standard §5): 초록 면은 행동에만. 기본 표시는 연회색 면 위 흰 태그 + 검정 굵은 글자 */}
            {addr.isDefault && (
              <span className="rounded-[var(--radius-tag)] bg-background px-2 text-[13px] leading-5 font-bold text-[var(--color-text)]">
                기본
              </span>
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
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {addr.zipCode}
          </p>
        </div>
      </div>
      {/* 흰 면·검정 글자 외곽선 버튼(연회색 외곽선 글자는 연회색 면 위 대비 3.0:1이었다, design-standard §4) */}
      <div className="mt-2.5 flex flex-row flex-wrap items-center justify-start gap-2.5">
        {!addr.isDefault && (
          <UiButton type="button" size="xs" variant="plain" onClick={onSetDefault}>
            기본으로 설정
          </UiButton>
        )}
        <UiButton type="button" size="xs" variant="plain" onClick={onEdit}>
          수정
        </UiButton>
        {/* ② 방향(design-standard §4·§5): 카드의 버튼은 모두 검정 글자 외곽선(plain)·높이 44px. 삭제는 확인창을 거친다. */}
        <UiButton type="button" size="xs" variant="plain" onClick={onDelete}>
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
            className="pointer-events-auto relative flex max-h-[90dvh] w-[440px] max-w-full flex-col overflow-y-auto rounded-[8px] bg-popover text-ui-ink shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none will-change-[opacity] duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <DialogClose
              data-slot="dialog-close"
              aria-label="닫기"
              className={cn(closeButtonClassName, DIALOG_CLOSE_TOUCH)}
            >
              <CloseIcon style={DIALOG_CLOSE_ICON_STYLE} />
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
        className={`${TOUCH_HEIGHT} rounded-[8px]`}
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
  // 삭제 확인창: 닫힘 → 열림 → 처리 중(확정 뒤 삭제 요청이 끝날 때까지) 중 하나이고, 열린 동안 지울 배송지를 함께 든다.
  const [deleteDialog, setDeleteDialog] = useState<
    { state: 'closed' } | { state: 'open' | 'submitting'; addr: SavedAddress }
  >({ state: 'closed' });

  if (status === 'unauthenticated') {
    router.replace(currentMyPageLoginUrl());
    return null;
  }

  // 확인창의 확정. 처리 중에는 창이 닫히지 않고, 끝나면(성공·실패 모두) 닫는다. 실패 안내는 화면 위 상자가 맡는다.
  async function handleDelete() {
    if (deleteDialog.state !== 'open') return;
    const { addr } = deleteDialog;
    setDeleteDialog({ state: 'submitting', addr });
    setActionError(null);
    try {
      await deleteAddress(addr.id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleteDialog({ state: 'closed' });
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
        <MyPageBackButton />
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
                  {/* 흰 면·검정 글자 외곽선(알림 화면의 "다시 시도"와 같다. 흰 면 위 빨강 글자는 대비 3.3:1이었다) */}
                  <UiButton type="button" size="xs" variant="plain" onClick={() => refetch()}>
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

      {/* 조회 실패 안내와 "다시 시도"는 위 빨강 상자 한 번만 보인다(목록 자리에 같은 안내를 다시 쓰지 않는다). */}
      {loading ? (
        <p className={`${TEXT} py-10 text-center`} style={DISABLED_TEXT_STYLE}>
          불러오는 중...
        </p>
      ) : error && addresses.length === 0 ? null : addresses.length === 0 ? (
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
              onDelete={() => setDeleteDialog({ state: 'open', addr })}
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

      <ConfirmDialog
        state={deleteDialog.state}
        content={
          deleteDialog.state === 'closed' ? null : addressDeleteConfirmContent(deleteDialog.addr)
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ state: 'closed' })}
      />
    </div>
  );
}
