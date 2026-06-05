'use client';

import type { AdminBanner, BannerCta, BannerKind } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';

export type { AdminBanner, BannerCta, BannerKind };

export interface AdminBannerForm {
  id?: string;
  kind: BannerKind;
  imageUrl?: string;
  tagText?: string;
  headline?: string;
  subText?: string;
  cta1?: BannerCta;
  cta2?: BannerCta;
  startDate?: string;
  endDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AdminActionResult {
  ok: boolean;
  reason?: string;
}

interface AdminBannersResponse {
  banners?: AdminBanner[];
}

function toPayload(form: AdminBannerForm) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = form;
  return payload;
}

function errorReason(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useAdminBanners() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiJson<AdminBannersResponse>('/admin/banners', token);
      setBanners(data.banners ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveBanner = async (form: AdminBannerForm): Promise<AdminActionResult> => {
    if (!token) return { ok: false, reason: '관리자 인증이 필요합니다.' };
    setSaving(true);
    try {
      const body = JSON.stringify(toPayload(form));
      if (form.id) {
        await apiJson(`/admin/banners/${form.id}`, token, { method: 'PUT', body });
      } else {
        await apiJson('/admin/banners', token, { method: 'POST', body });
      }
      await load();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: errorReason(error, '배너 저장 중 오류가 발생했습니다.') };
    } finally {
      setSaving(false);
    }
  };

  const deleteBanner = async (id: string): Promise<AdminActionResult> => {
    if (!token) return { ok: false, reason: '관리자 인증이 필요합니다.' };
    setSaving(true);
    try {
      await apiJson(`/admin/banners/${id}`, token, { method: 'DELETE' });
      await load();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: errorReason(error, '배너 삭제 중 오류가 발생했습니다.') };
    } finally {
      setSaving(false);
    }
  };

  return { banners, loading, saving, reload: load, saveBanner, deleteBanner };
}

export function useAdminBanner() {
  const { banners, loading, saving, reload, saveBanner } = useAdminBanners();
  const banner = banners.find((item) => item.kind === 'default') ?? null;

  return {
    banner,
    loading,
    saving,
    reload,
    save: (form: AdminBannerForm) =>
      saveBanner({ ...form, id: banner?.id ?? form.id, kind: 'default' }),
  };
}
