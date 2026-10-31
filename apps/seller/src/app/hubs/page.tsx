'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button, ButtonLink } from '@greenhub/ui/components/button';
import { notify } from '@/components/AppToaster';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';

// ① 외형 유지(UI 교체 P4): Mantine Container(sm)·Stack·Group·Paper·Text·UnstyledButton·Badge·Button과 같은 값을
// Tailwind와 @greenhub/ui로 그린다. Text = p(16px·줄 높이 1.55·여백 0), Paper = 흰 바탕·모서리 16·그림자 xs.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

interface Hub {
  id: string;
  name: string;
  address: string;
  addressDetail: string | null;
  operatingHours: string | null;
  isActive: boolean;
}

export default function HubsPage() {
  const { data: session } = useSession();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchHubs = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    try {
      const data = await apiJson<{ hubs: Hub[] }>(`/stores/${storeId}/hubs`, token);
      setHubs(data.hubs);
    } catch {
      // GET 실패는 silent (초기 로딩 노이즈 방지)
    } finally {
      setLoading(false);
    }
  }, [storeId, token]);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  async function toggleActive(hub: Hub) {
    if (!storeId || !token) return;
    try {
      await apiJson(`/stores/${storeId}/hubs/${hub.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !hub.isActive }),
      });
      setHubs((prev) => prev.map((h) => (h.id === hub.id ? { ...h, isActive: !hub.isActive } : h)));
    } catch (e) {
      notify({
        color: 'red',
        title: '거점 상태 변경 실패',
        message: e instanceof ApiError ? e.message : '거점 상태 변경에 실패했습니다',
      });
    }
  }

  async function deleteHub(hubId: string) {
    if (!storeId || !token) return;
    setDeleting(true);
    try {
      await apiJson(`/stores/${storeId}/hubs/${hubId}`, token, {
        method: 'DELETE',
      });
      setHubs((prev) => prev.filter((h) => h.id !== hubId));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '삭제에 실패했습니다');
      setDeleteTargetId(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="거점 관리"
        right={
          <ButtonLink
            render={<Link href="/hubs/new" />}
            size="xs"
            className="rounded-[8px]"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            + 거점 등록
          </ButtonLink>
        }
      />

      <div className="mx-auto max-w-[720px] px-4 py-4">
        {error && (
          <p
            className={TEXT}
            style={{
              marginBottom: 12,
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-danger)',
            }}
          >
            {error}
          </p>
        )}

        {loading ? (
          <LoadingState />
        ) : hubs.length === 0 ? (
          <EmptyState
            icon={
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
            text="등록된 거점이 없습니다"
            action={
              <Link
                href="/hubs/new"
                className={`${TEXT} no-underline`}
                style={{
                  marginTop: 10,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-primary-dark)',
                  fontWeight: 500,
                }}
              >
                거점 등록하기 →
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col items-stretch justify-start gap-3">
            {hubs.map((hub) => (
              <div key={hub.id} className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
                <div className="flex flex-row flex-wrap items-start justify-between gap-2.5">
                  <Link
                    href={`/hubs/${hub.id}`}
                    className={UNSTYLED_BUTTON}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <div className="mb-1 flex flex-row flex-wrap items-center justify-start gap-2.5">
                      <p
                        className={`${TEXT} truncate`}
                        style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--font-size-sm)' }}
                      >
                        {hub.name}
                      </p>
                      <Badge
                        variant={hub.isActive ? 'light-green' : 'secondary'}
                        size="xs"
                        className="rounded-[32px]"
                        style={{ flexShrink: 0 }}
                      >
                        {hub.isActive ? '운영 중' : '비활성'}
                      </Badge>
                    </div>
                    <p
                      className={`${TEXT} truncate`}
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {hub.address}
                    </p>
                    {hub.addressDetail && (
                      <p
                        className={TEXT}
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        {hub.addressDetail}
                      </p>
                    )}
                    {hub.operatingHours && (
                      <p
                        className={TEXT}
                        style={{
                          marginTop: 4,
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        운영: {hub.operatingHours}
                      </p>
                    )}
                  </Link>
                  <div
                    className="flex flex-col items-stretch justify-start gap-1"
                    style={{ flexShrink: 0 }}
                  >
                    <Button
                      onClick={() => toggleActive(hub)}
                      size="xs"
                      variant="light-blue"
                      className="rounded-[8px]"
                    >
                      {hub.isActive ? '비활성화' : '활성화'}
                    </Button>
                    <Button
                      onClick={() => setDeleteTargetId(hub.id)}
                      size="xs"
                      variant="light-destructive"
                      className="rounded-[8px]"
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        opened={deleteTargetId !== null}
        title="거점 삭제"
        message="거점을 삭제하시겠습니까?"
        confirmLabel="삭제"
        loading={deleting}
        onConfirm={() => {
          if (deleteTargetId) deleteHub(deleteTargetId);
        }}
        onClose={() => {
          if (!deleting) setDeleteTargetId(null);
        }}
      />
    </PageShell>
  );
}
