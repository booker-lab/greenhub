'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import type { AdminBanner } from './useAdmin.types';

// ── Banner ───────────────────────────────────────────────────────

export function useAdminBanner() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [banner, setBanner] = useState<AdminBanner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Read failure는 genuine unset과 구분된다.
  // 백엔드 계약(AdminService.getBanner): 미설정 문서는 200 + null 반환,
  // 조회 실패만 non-2xx throw → error가 null이 아닌 경우만 FETCH_ERROR다.
  // 404 의미를 새로 정의하지 않는다 — null + error null이 unset의 전부다.
  const [error, setError] = useState<string | null>(null);
  // Save confirmed failure — "저장 완료" 상태로 붕괴하지 않도록 호출자에 노출한다.
  const [saveError, setSaveError] = useState<string | null>(null);

  // 처음 조회와 저장 뒤 재조회를 나눈다. 저장 뒤 재조회까지 화면 전체를 "불러오는 중"으로
  // 바꾸면 방금 편집하던 양식이 깜빡이며 사라졌다 돌아온다.
  const fetchBanner = useCallback(
    async (background: boolean) => {
      if (!token) return;
      if (!background) {
        setLoading(true);
        setError(null);
      }
      try {
        setBanner(await apiJson<AdminBanner | null>('/admin/banner', token));
      } catch {
        // 이전 성공 banner를 null로 덮어쓰지 않는다 — error 존재 자체가 실패의 증거다.
        // 저장 뒤 재조회 실패는 저장 성공을 뒤집지 않는다 — 양식에 저장한 값이 그대로 있으므로
        // 화면을 조회 실패로 바꾸지 않는다.
        if (!background) setError('배너 조회 중 오류 발생');
      } finally {
        if (!background) setLoading(false);
      }
    },
    [token],
  );
  const load = useCallback(() => fetchBanner(false), [fetchBanner]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (dto: AdminBanner): Promise<boolean> => {
    if (!token) return false;
    setSaving(true);
    setSaveError(null);
    // 서버 관리 필드 제거 (forbidNonWhitelisted 대응)
    const {
      updatedAt: _u,
      createdAt: _c,
      ...payload
    } = dto as AdminBanner & Record<string, unknown>;
    try {
      await apiJson('/admin/banner', token, { method: 'PUT', body: JSON.stringify(payload) });
      await fetchBanner(true);
      return true;
    } catch {
      setSaveError('배너 저장 중 오류 발생');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { banner, loading, saving, error, saveError, save, reload: load };
}
