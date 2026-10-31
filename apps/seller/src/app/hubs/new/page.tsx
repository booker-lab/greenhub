'use client';

import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useId, useState } from 'react';
import { ApiError, apiJson } from '@/lib/api';

// ① 외형 유지(UI 교체 P4): Mantine Container(xs 540px)·Group·ActionIcon·Title order 2·Paper(lg·sm·lg)·Stack·
// TextInput(radius xl)·Text·Button과 같은 값을 Tailwind와 @greenhub/ui로 그린다.
// 라벨은 Mantine처럼 inline-block이고, 필수 칸은 직접 붙인 빨간 "*" 뒤에 required 별표가 한 번 더 붙는다(지금 화면 그대로).
const TEXT = 'm-0 p-0 text-base font-normal';

export default function NewHubPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const formId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    address: '',
    addressDetail: '',
    operatingHours: '',
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (!storeId || !token) return;

    setError('');
    setLoading(true);
    try {
      await apiJson(`/stores/${storeId}/hubs`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          addressDetail: form.addressDetail || undefined,
          operatingHours: form.operatingHours || undefined,
        }),
      });
      router.push('/hubs');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-surface-muted)',
        padding: '32px 16px',
      }}
    >
      <div className="mx-auto max-w-[540px] px-4">
        <div className="mb-5 flex flex-row flex-wrap items-center justify-start gap-3">
          <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => router.back()}>
            <ChevronLeft className="size-5" />
          </Button>
          <h2
            className="m-0 leading-[1.35] font-extrabold"
            style={{ fontSize: 'var(--font-size-xl)' }}
          >
            거점 등록
          </h2>
        </div>

        <div className="block rounded-[16px] bg-white p-5 shadow-mantine-sm">
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col items-stretch justify-start gap-4">
              <Field>
                <FieldLabel htmlFor={`${formId}-name`} className="inline-block" required>
                  거점 이름{' '}
                  <span className={TEXT} style={{ color: 'var(--color-danger)' }}>
                    *
                  </span>
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
                <FieldLabel htmlFor={`${formId}-address`} className="inline-block" required>
                  주소{' '}
                  <span className={TEXT} style={{ color: 'var(--color-danger)' }}>
                    *
                  </span>
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
                <FieldLabel htmlFor={`${formId}-addressDetail`} className="inline-block">
                  상세 주소{' '}
                  <span className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
                    (선택)
                  </span>
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
                <FieldLabel htmlFor={`${formId}-operatingHours`} className="inline-block">
                  운영 시간{' '}
                  <span className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
                    (선택)
                  </span>
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
                disabled={loading}
                size="md"
                className="mt-2.5 w-full"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {loading ? '등록 중...' : '거점 등록'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
