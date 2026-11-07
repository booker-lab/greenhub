'use client';

import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { ChevronLeft, Store } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { notify } from '@/components/AppToaster';
import { ApiError, apiJson } from '@/lib/api';
import { getFirebaseStorage } from '@/lib/firebase';
import { logout } from '@/lib/logout';
import { confirmSessionStore } from '@/lib/onboarding-session';
import { useTokenRef } from '@/lib/use-token-ref';
import {
  ImageReencodeError,
  imageReencodeFailureMessage,
  LOGO_IMAGE_ENCODE,
  reencodeImageToJpeg,
} from '../products/_components/image-reencode';

// ① 외형 유지(UI 교체 P4): Mantine Container size xs(최대 540px)·Group·Stack·Paper(radius lg·p lg; 그림자는 ② D2로 걷음)·
// Title order 2(줄 높이 1.35·800)·Text·Divider·TextInput(radius xl, 필수 표시 *)·ActionIcon subtle gray와 같은 값.
const TEXT = 'm-0 p-0 text-base';
const DIVIDER = 'm-0 h-0 border-0 border-t border-solid border-ui-gray-3';

/** Mantine TextInput(size sm, radius xl). 필수면 라벨 뒤에 빨간 *를 붙인다(Mantine withAsterisk). */
function TextField({
  label,
  required,
  name,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & { label: React.ReactNode; name: string }) {
  const id = `onboarding-${name}`;
  return (
    <Field>
      <FieldLabel htmlFor={id} className="inline-block">
        {label}
        {required && (
          <span aria-hidden="true" className="text-ui-red">
            {' *'}
          </span>
        )}
      </FieldLabel>
      <Input id={id} name={name} required={required} className="rounded-[32px]" {...props} />
    </Field>
  );
}

export default function OnboardingPage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');
  const [error, setError] = useState('');
  // 이 화면에서 방금 만든 가게. 세션에 반영되기 전 다시 저장해 가게가 두 번 생기지 않게 막는다.
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  // 가게가 이미 있으면 설정 > 사업자 프로필 수정으로 들어온 것 — 처음 등록과 제목·버튼·돌아갈 곳이 다르다.
  // 방금 만든 가게가 세션에 실려도 판매자 화면으로 넘어가기 전까지는 등록 화면을 유지한다.
  const isEdit = !!session?.user.storeId && !createdStoreId;

  const [form, setForm] = useState({
    name: '',
    ceoName: '',
    phone: '',
    address: '',
    businessNumber: '',
    logoUrl: '',
  });

  // 토큰 갱신만으로 매장 정보를 다시 읽어 고치는 중인 프로필을 덮지 않는다(매장이 바뀌면 다시 읽는다).
  const { tokenRef, hasToken } = useTokenRef(session?.user.accessToken);

  useEffect(() => {
    const storeId = session?.user.storeId;
    const token = tokenRef.current;
    if (!storeId || !hasToken) return;
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
      .catch(() => {
        // 기존 store GET 실패 시 빈 폼 유지 (silent)
      });
  }, [session?.user.storeId, hasToken, tokenRef]);

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
      // Storage SDK는 올릴 때만 불러온다.
      const [{ getDownloadURL, ref, uploadBytes }, storage] = await Promise.all([
        import('firebase/storage'),
        getFirebaseStorage(),
      ]);
      const storageRef = ref(storage, `logos/${session?.user.id ?? 'unknown'}_${Date.now()}`);
      // canvas로 다시 그려 EXIF(촬영 위치 등)를 지운 JPEG만 올린다.
      const jpeg = await reencodeImageToJpeg(file, LOGO_IMAGE_ENCODE);
      await uploadBytes(storageRef, jpeg, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(storageRef);
      setLogoPreview(url);
      setForm((prev) => ({ ...prev, logoUrl: url }));
    } catch (e) {
      setError(
        e instanceof ImageReencodeError
          ? imageReencodeFailureMessage(e.reason)
          : '로고 업로드에 실패했습니다. 다시 시도해주세요.',
      );
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

  // 서버 세션에 새 storeId가 실린 것을 확인한 뒤 전체 페이지 이동으로 판매자 화면에 간다.
  // 확인 전에 이동하면 proxy가 storeId 없는 세션으로 보고 /onboarding으로 되돌린다.
  // update({})는 jwt 콜백이 API로 다시 검증하게 하고 갱신된 세션 쿠키를 받는다(클라이언트 값은 쓰지 않는다).
  async function enterSellerHome(storeId: string): Promise<boolean> {
    const confirmed = await confirmSessionStore({ refresh: () => update({}), storeId });
    if (confirmed) window.location.assign('/orders');
    return confirmed;
  }

  async function handleStart() {
    if (!createdStoreId) return;
    setError('');
    setEntering(true);
    if (await enterSellerHome(createdStoreId)) return;
    setEntering(false);
    setError('아직 가게 정보가 반영되지 않았어요. 잠시 후 다시 눌러주세요.');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createdStoreId) return;
    if (!session?.user.storeId && !form.name) {
      setError('상호명을 입력해주세요.');
      return;
    }
    setError('');
    setLoading(true);

    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
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
        setCreatedStoreId(data.storeId);
        // 이동하는 동안에는 저장 중 상태를 유지한다. 반영을 확인하지 못하면 '시작하기' 안내를 보인다.
        if (await enterSellerHome(data.storeId)) return;
      } else {
        await apiJson(`/stores/${storeId}`, token, { method: 'PATCH', body });
        notify({ color: 'brand', message: '사업자 정보를 저장했어요.' });
        router.push('/settings');
        return;
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다. 다시 시도해주세요.');
    }
    setLoading(false);
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: 'var(--frame)', padding: '32px 16px' }}>
      <div className="mx-auto max-w-[540px] px-4">
        {isEdit ? (
          <div className="mb-5 flex flex-row flex-nowrap items-center justify-start gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => router.push('/settings')}
              aria-label="설정으로 돌아가기"
            >
              <ChevronLeft size={20} className="size-5" />
            </Button>
            <h2
              className="m-0 leading-[1.35] font-extrabold"
              style={{ fontSize: 'var(--font-size-xl)' }}
            >
              사업자 프로필 수정
            </h2>
          </div>
        ) : (
          <div className="mb-8 flex flex-col items-center justify-start gap-2.5">
            <h2
              className="m-0 leading-[1.35] font-extrabold"
              style={{ fontSize: 'var(--font-size-xl)' }}
            >
              사업자 정보 등록
            </h2>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              서비스 시작 전 한 번만 입력합니다
            </p>
          </div>
        )}

        <div className="block rounded-[16px] bg-card p-5">
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col items-stretch justify-start gap-4">
              {/* 로고 업로드 */}
              <div className="flex flex-col items-center justify-start gap-2.5 pb-2.5">
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    border: '2px dashed var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    backgroundColor: 'var(--color-surface-muted)',
                    position: 'relative',
                  }}
                >
                  {logoPreview ? (
                    <Image
                      fill
                      src={logoPreview}
                      alt="로고 미리보기"
                      sizes="80px"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <Store size={32} color="var(--color-text-disabled)" aria-hidden="true" />
                  )}
                </div>
                <label style={{ cursor: 'pointer' }}>
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-primary-dark)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
                    {logoUploading ? '업로드 중...' : '로고 사진 선택'}
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                    disabled={logoUploading}
                  />
                </label>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  선택 사항 · JPG, PNG, WebP 권장
                </p>
              </div>

              <hr className={DIVIDER} />

              <TextField
                label="상호명"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="예: 디어 오키드"
              />

              <TextField
                label="대표자명"
                name="ceoName"
                value={form.ceoName}
                onChange={handleChange}
                required
                placeholder="예: 홍길동"
              />

              <TextField
                label="연락처"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                placeholder="010-0000-0000"
              />

              <TextField
                label="소재지"
                name="address"
                value={form.address}
                onChange={handleChange}
                required
                placeholder="사업장 주소"
              />

              <hr className={DIVIDER} />

              <TextField
                label={
                  <>
                    사업자등록번호{' '}
                    <span
                      className="m-0 p-0 text-base font-normal"
                      style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}
                    >
                      (선택)
                    </span>
                  </>
                }
                name="businessNumber"
                value={form.businessNumber}
                onChange={handleChange}
                placeholder="000-00-00000"
              />

              {error && (
                <p
                  className={`${TEXT} text-center`}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                >
                  {error}
                </p>
              )}

              {createdStoreId && !loading ? (
                <>
                  <p
                    className={`${TEXT} text-center`}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    가게를 등록했어요. 시작하기를 눌러 판매를 시작해주세요.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void handleStart()}
                    disabled={entering}
                    size="md"
                    className="w-full"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    {entering ? '확인 중...' : '시작하기'}
                  </Button>
                </>
              ) : (
                <Button
                  type="submit"
                  disabled={loading}
                  size="md"
                  className="mt-2.5 w-full"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {loading ? '저장 중...' : isEdit ? '저장' : '저장 후 시작하기'}
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* 가게 없는 계정은 모든 화면이 이곳으로 오므로 다른 계정으로 바꿀 수단을 둔다. */}
        {!isEdit && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="mt-4 w-full"
            onClick={() => void logout()}
          >
            다른 계정으로 로그인
          </Button>
        )}
      </div>
    </main>
  );
}
