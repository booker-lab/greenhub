'use client';

import { Button } from '@greenhub/ui/components/button';
import { Switch } from '@greenhub/ui/components/switch';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { type AdminBanner, useAdminBanner } from '@/hooks/useAdmin';
import { useResettableTimeout } from '@/hooks/useResettableTimeout';
import { getFirebaseStorage } from '@/lib/firebase';
import {
  ImageReencodeError,
  imageFileRejection,
  imageReencodeFailureMessage,
  PRODUCT_IMAGE_ENCODE,
  reencodeImageToJpeg,
} from '../../products/_components/image-reencode';
import { BannerCtaSection } from './_components/BannerCtaSection';
import { BannerImageSection } from './_components/BannerImageSection';
import { BannerTextSection } from './_components/BannerTextSection';

export default function AdminBannerClient() {
  const { data: session } = useSession();
  // read failure는 error/reload로 소비한다 — banner null만으로 unset을 단정하지 않는다.
  const { banner, loading, saving, error, saveError, save, reload } = useAdminBanner();

  const [form, setForm] = useState<AdminBanner>({
    imageUrl: '',
    tagText: '',
    headline: '',
    subText: '',
    cta1: { label: '', href: '' },
    cta2: { label: '', href: '' },
    isActive: true,
  });
  const [uploading, setUploading] = useState(false);
  // Firebase image upload는 기존 계약을 재설계하지 않는다.
  // 다만 완전 silent 실패는 복구 불가이므로 동일 UI 안에서 최소 오류 표면만 제공한다.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedResetTimer = useResettableTimeout();

  // 서버 상태 hydrate는 banner 갱신(초기 로드·저장 후 reload) 시에만 1회 반영한다.
  // form을 deps에 넣으면 편집 입력이 서버 값으로 매번 덮어쓰여 실패 후 입력 보존이 깨진다.
  const hydratedRef = useRef<AdminBanner | null>(null);
  useEffect(() => {
    if (banner && hydratedRef.current !== banner) {
      hydratedRef.current = banner;
      setForm((prev) => ({ ...prev, ...banner }));
    }
  }, [banner]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // 거절 사유를 구체적으로 알린다 — 아무 반응 없이 끝나면 관리자는 왜 안 되는지 모른다.
    if (!session?.user) {
      setUploadError('로그인 정보를 확인하는 중입니다. 잠시 뒤 다시 시도해주세요.');
      return;
    }
    const rejection = imageFileRejection(file);
    if (rejection) {
      setUploadError(rejection);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      // 배너 사진은 누구나 받을 수 있는 공개 사진이다. canvas로 다시 그려 EXIF(촬영 위치 등)를
      // 지운 JPEG만 올리고, 원본 파일명도 경로에 쓰지 않는다. Storage SDK는 올릴 때만 불러온다.
      const jpeg = await reencodeImageToJpeg(file, PRODUCT_IMAGE_ENCODE);
      const [{ getDownloadURL, ref: storageRef, uploadBytes }, storage] = await Promise.all([
        import('firebase/storage'),
        getFirebaseStorage(),
      ]);
      const r = storageRef(storage, `banners/main_hero/${Date.now()}.jpg`);
      await uploadBytes(r, jpeg, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(r);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (err) {
      // 실패해도 기존 form 입력(imageUrl 포함)은 그대로 보존된다.
      setUploadError(
        err instanceof ImageReencodeError
          ? imageReencodeFailureMessage(err.reason)
          : '이미지 업로드 중 오류 발생',
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    // 이전 성공 표시가 실패 건에 잔류하지 않도록 먼저 내린다.
    setSaved(false);
    const ok = await save(form);
    if (ok) {
      setSaved(true);
      savedResetTimer.schedule(() => setSaved(false), 2000);
    }
    // 실패 시 form은 그대로 보존되고 saveError 블록이 실패 feedback을 제공한다.
    // "저장 완료" 표시는 ok confirmed success에서만 설정된다.
  };

  // ① 외형 유지(UI 교체 P2b): Mantine Text·Group·Title order 4(18px·800·줄 높이 1.45)·Paper·Stack·Switch(label)와 같은 값.
  if (loading) {
    return (
      <p
        className="m-0 p-0 py-20 text-center text-base"
        style={{ color: 'var(--color-text-disabled)' }}
      >
        불러오는 중...
      </p>
    );
  }

  // read failure 상태에서는 기본 빈 form을 authoritative current state처럼 편집/저장하게 하지 않는다.
  if (error !== null) {
    return (
      <div>
        <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
          <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">히어로 배너 관리</h4>
        </div>
        <div
          className="block rounded-[16px] bg-white shadow-paper-xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <div className="flex flex-col items-center gap-3 px-4 py-16">
            <p
              className="m-0 p-0 text-base"
              style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}
            >
              배너 정보를 불러오지 못했습니다.
            </p>
            <p
              className="m-0 p-0 text-center text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </p>
            <Button onClick={reload} variant="outline" className="rounded-[8px]">
              다시 조회
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
        <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">히어로 배너 관리</h4>
        {/* Mantine Switch label(오른쪽): 트랙 뒤 12px, 15px·줄 높이 20px 글자. */}
        <div className="relative">
          <div className="flex [-webkit-tap-highlight-color:transparent]">
            <Switch
              id="banner-active"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
            />
            <div className="order-2 inline-flex flex-col text-sm leading-[20px]">
              <label htmlFor="banner-active" className="ps-3 text-inherit">
                배너 활성화
              </label>
            </div>
          </div>
        </div>
      </div>

      {banner === null && (
        <p
          className="m-0 mb-4 p-0 text-base"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          현재 설정된 배너가 없습니다. 아래 양식으로 새 배너를 등록하세요.
        </p>
      )}

      {saveError !== null && (
        <div
          className="mb-4 block rounded-[16px] bg-white p-4 shadow-paper-xs"
          style={{ border: '1px solid var(--color-danger)' }}
        >
          <div className="flex flex-col items-center gap-2.5">
            <p
              className="m-0 p-0 text-base"
              style={{ fontWeight: 500, color: 'var(--color-danger)' }}
            >
              배너 저장에 실패했습니다.
            </p>
            <p
              className="m-0 p-0 text-center text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {saveError} 입력 내용은 그대로 보존되어 있으니 다시 시도해 주세요.
            </p>
            <Button
              onClick={handleSave}
              variant="outline"
              className="rounded-[8px]"
              disabled={saving}
            >
              다시 저장
            </Button>
          </div>
        </div>
      )}

      {uploadError !== null && (
        <p
          className="m-0 mb-4 p-0 text-center text-base"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {uploadError} 기존 이미지는 그대로 유지됩니다.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <BannerImageSection
          imageUrl={form.imageUrl}
          uploading={uploading}
          onUpload={handleImageUpload}
        />
        <BannerTextSection form={form} setForm={setForm} />
        <BannerCtaSection form={form} setForm={setForm} />

        <Button
          onClick={handleSave}
          disabled={saving}
          size="md"
          style={{ backgroundColor: saved ? 'var(--color-primary-light)' : 'var(--color-primary)' }}
        >
          {saving ? '저장 중...' : saved ? '저장 완료!' : '저장하기'}
        </Button>
      </div>
    </div>
  );
}
