'use client';

import { apiPathSegment, readRouteParam } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useId, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';

// ① 외형 유지(UI 교체 P4): Mantine Container(sm)·Paper(lg·sm·lg)·Stack(md)·TextInput(radius xl)·Text·Button과 같은 값.
// 라벨은 Mantine처럼 inline-block이다(글자 뒤에 붙인 "(선택)"과 사이가 한 칸). 필수 칸은 Mantine처럼 직접 붙인 빨간 "*" 뒤에 required 별표가 한 번 더 붙는다(지금 화면 그대로).
const TEXT = 'm-0 p-0 text-base font-normal';

const INVALID_HUB_ADDRESS_MESSAGE =
  '거점 주소가 올바르지 않습니다. 거점 목록에서 다시 선택해 주세요.';

interface Hub {
  id: string;
  name: string;
  address: string;
  addressDetail: string | null;
  operatingHours: string | null;
  isActive: boolean;
}

/** 필수 필드 라벨에 빨간 별표를 붙인다. */
function RequiredLabel({ children }: { children: string }) {
  return (
    <>
      {children}{' '}
      <span className={TEXT} style={{ color: 'var(--color-danger)' }}>
        *
      </span>
    </>
  );
}

/** 선택 필드 라벨에 회색 "(선택)" 표기를 붙인다. */
function OptionalLabel({ children }: { children: string }) {
  return (
    <>
      {children}{' '}
      <span className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
        (선택)
      </span>
    </>
  );
}

export default function EditHubPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const formId = useId();
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 요청하지 않는다.
  const hubId = readRouteParam(params.id);

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    address: '',
    addressDetail: '',
    operatingHours: '',
  });

  const fetchHub = useCallback(async () => {
    if (!storeId || !token || !hubId) return;
    setLoading(true);
    setError('');
    try {
      const hub = await apiJson<Hub>(
        `/stores/${apiPathSegment(storeId)}/hubs/${apiPathSegment(hubId)}`,
        token,
      );
      setForm({
        name: hub.name,
        address: hub.address,
        addressDetail: hub.addressDetail ?? '',
        operatingHours: hub.operatingHours ?? '',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '거점 정보를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, [storeId, token, hubId]);

  useEffect(() => {
    fetchHub();
  }, [fetchHub]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !token || !hubId) return;

    setError('');
    setSaving(true);
    try {
      // addressDetail·operatingHours는 폼 값을 그대로 전송 — 빈 문자열로
      // 비우면 updateHub가 해당 필드를 ''로 갱신한다(undefined면 미변경).
      await apiJson(`/stores/${apiPathSegment(storeId)}/hubs/${apiPathSegment(hubId)}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          addressDetail: form.addressDetail,
          operatingHours: form.operatingHours,
        }),
      });
      router.push(`/hubs/${encodeURIComponent(hubId)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장에 실패했습니다');
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="거점 수정" onBack={() => router.back()} />

      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!hubId ? (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            {INVALID_HUB_ADDRESS_MESSAGE}
          </p>
        ) : loading ? (
          <LoadingState />
        ) : (
          <div className="block rounded-[16px] bg-white p-5 shadow-mantine-sm">
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col items-stretch justify-start gap-4">
                <Field>
                  <FieldLabel htmlFor={`${formId}-name`} required>
                    <RequiredLabel>거점 이름</RequiredLabel>
                  </FieldLabel>
                  <Input
                    id={`${formId}-name`}
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="예: 강남 거점"
                    className="rounded-xl"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor={`${formId}-address`} required>
                    <RequiredLabel>주소</RequiredLabel>
                  </FieldLabel>
                  <Input
                    id={`${formId}-address`}
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    required
                    placeholder="거점 주소"
                    className="rounded-xl"
                  />
                </Field>

                <Field>
                  <FieldLabel className="inline-block" htmlFor={`${formId}-addressDetail`}>
                    <OptionalLabel>상세 주소</OptionalLabel>
                  </FieldLabel>
                  <Input
                    id={`${formId}-addressDetail`}
                    name="addressDetail"
                    value={form.addressDetail}
                    onChange={handleChange}
                    placeholder="동/호수, 층 등"
                    className="rounded-xl"
                  />
                </Field>

                <Field>
                  <FieldLabel className="inline-block" htmlFor={`${formId}-operatingHours`}>
                    <OptionalLabel>운영 시간</OptionalLabel>
                  </FieldLabel>
                  <Input
                    id={`${formId}-operatingHours`}
                    name="operatingHours"
                    value={form.operatingHours}
                    onChange={handleChange}
                    placeholder="예: 09:00~18:00"
                    className="rounded-xl"
                  />
                </Field>

                {error && (
                  <p
                    className={`${TEXT} text-center`}
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  >
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={saving}
                  size="md"
                  className="mt-2.5 w-full"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {saving ? '저장 중...' : '변경 저장'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </PageShell>
  );
}
