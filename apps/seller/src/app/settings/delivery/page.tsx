'use client';

import { Switch } from '@greenhub/ui/components/switch';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { useResettableTimeout } from '@/hooks/useResettableTimeout';
import { ApiError, apiJson } from '@/lib/api';
import { Button } from '../../../components/Button';

interface DeliveryConfig {
  directFee: number;
  hubFee: number;
  parcelFee: number;
  freeThresholdDirect: number;
  freeThresholdHub: number;
  freeThresholdParcel: number;
  weatherRestrictionActive: boolean;
}

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(안쪽 20; 그림자는 ② D2로 걷음) 값.
const TEXT = 'm-0 p-0 text-base';
const PAPER = 'block rounded-[16px] bg-card p-5';

const DEFAULTS: DeliveryConfig = {
  directFee: 3000,
  hubFee: 1000,
  parcelFee: 4000,
  freeThresholdDirect: 50000,
  freeThresholdHub: 30000,
  freeThresholdParcel: 50000,
  weatherRestrictionActive: false,
};

export default function DeliverySettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedResetTimer = useResettableTimeout();
  const [error, setError] = useState('');

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  useEffect(() => {
    if (!storeId || !token) return;
    // 소유자 확인 경로: 관리자가 가게를 치워 손님 화면에서 숨겨도 판매자 본인은 설정을 본다.
    apiJson<Partial<DeliveryConfig>>(`/stores/${storeId}/delivery-config/owner`, token)
      .then((data) => {
        setConfig({ ...DEFAULTS, ...data });
      })
      .catch(() => {
        // GET 실패는 silent (DEFAULTS 유지)
      })
      .finally(() => setLoading(false));
  }, [storeId, token]);

  function handleNum(field: keyof DeliveryConfig, value: string) {
    const num = parseInt(value, 10);
    if (!Number.isNaN(num) && num >= 0) setConfig((prev) => ({ ...prev, [field]: num }));
  }

  async function handleSave() {
    if (!storeId || !token) return;
    setSaving(true);
    setError('');
    try {
      await apiJson(`/stores/${storeId}/delivery-config`, token, {
        method: 'PATCH',
        body: JSON.stringify(config),
      });
      setSaved(true);
      savedResetTimer.schedule(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--frame)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          불러오는 중...
        </p>
      </main>
    );
  }

  return (
    <PageShell>
      {/* 머리는 다른 화면과 같은 부품을 쓴다. 뒤로는 이전 화면이다. */}
      <PageHeader title="배송비 설정" onBack={() => router.back()} containerSize="xs" />
      <div className="mx-auto max-w-[540px] px-4 pt-4 pb-8">
        <div className="flex flex-col gap-4">
          {/* 배송 방법별 기본 배송비 */}
          <div className={PAPER}>
            <p
              className={`${TEXT} mb-4`}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              기본 배송비
            </p>
            <div className="flex flex-col gap-3">
              {(
                [
                  { label: '직배송', field: 'directFee' },
                  { label: '거점 픽업', field: 'hubFee' },
                  { label: '택배', field: 'parcelFee' },
                ] as { label: string; field: keyof DeliveryConfig }[]
              ).map(({ label, field }) => (
                <div
                  key={field}
                  className="flex flex-row flex-nowrap items-center justify-between gap-4"
                >
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      width: 80,
                      flexShrink: 0,
                    }}
                  >
                    {label}
                  </p>
                  <div
                    className="flex min-w-0 flex-row flex-nowrap items-center justify-start gap-2.5"
                    style={{ flex: 1 }}
                  >
                    <input
                      type="number"
                      min="0"
                      step="500"
                      aria-label={`${label} 기본 배송비`}
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 44,
                        padding: '8px 12px',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'right',
                      }}
                    />
                    <p
                      className={TEXT}
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      원
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 무료 배송 기준 */}
          <div className={PAPER}>
            <p
              className={`${TEXT} mb-4`}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              무료 배송 기준금액
            </p>
            <div className="flex flex-col gap-3">
              {(
                [
                  { label: '직배송', field: 'freeThresholdDirect' },
                  { label: '거점 픽업', field: 'freeThresholdHub' },
                  { label: '택배', field: 'freeThresholdParcel' },
                ] as { label: string; field: keyof DeliveryConfig }[]
              ).map(({ label, field }) => (
                <div
                  key={field}
                  className="flex flex-row flex-nowrap items-center justify-between gap-4"
                >
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      width: 80,
                      flexShrink: 0,
                    }}
                  >
                    {label}
                  </p>
                  <div
                    className="flex min-w-0 flex-row flex-nowrap items-center justify-start gap-2.5"
                    style={{ flex: 1 }}
                  >
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      aria-label={`${label} 무료 배송 기준금액`}
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 44,
                        padding: '8px 12px',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'right',
                      }}
                    />
                    <p
                      className={TEXT}
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      원
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 기상 제한 토글 */}
          <div className={PAPER}>
            <div className="flex flex-row flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-text)',
                  }}
                >
                  기상 제한 배송
                </p>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  악천후 시 배송 제한 활성화
                </p>
              </div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Switch가 감싼 label 안에 숨은 checkbox를 그린다. 이름은 Switch의 aria-label이다. */}
              <label className="-my-3 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-end">
                <Switch
                  aria-label="기상 제한 배송"
                  checked={config.weatherRestrictionActive}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      weatherRestrictionActive: checked,
                    }))
                  }
                />
              </label>
            </div>
          </div>

          {error && (
            <p
              className={`${TEXT} text-center`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {error}
            </p>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
            size="md"
            className="h-11 w-full"
            style={{
              backgroundColor: saved ? 'var(--color-status-info-text)' : 'var(--primary)',
            }}
          >
            {saving ? '저장 중...' : saved ? '저장 완료!' : '저장'}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
