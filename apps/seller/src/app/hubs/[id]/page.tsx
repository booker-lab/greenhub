'use client';

import { apiPathSegment, readRouteParam } from '@greenhub/shared';
import { ButtonLink } from '@greenhub/ui/components/button';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';

// ① 외형 유지(UI 교체 P4): Mantine Container(sm)·Stack·Group·Paper·Text·Badge·Button과 같은 값을 Tailwind와
// @greenhub/ui로 그린다. Text = p(16px·줄 높이 1.55·여백 0), Paper = 흰 바탕·모서리 16·윤곽선 없음(그림자는 ② D2로 걷음).
// 주문 카드는 Mantine Paper component="button"처럼 같은 button 요소라 브라우저 기본 테두리도 그대로다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER =
  'block rounded-[16px] bg-white no-underline outline-0 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';
const CONTAINER = 'mx-auto max-w-[720px] px-4 py-4';

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

interface HubOrder {
  id: string;
  orderId?: string;
  status: string;
  totalAmount: number;
  createdAt: { seconds: number } | string;
  items?: { name: string; quantity: number }[];
  customerName?: string;
  pickupCode?: string;
}

function formatTime(ts: { seconds: number } | string | undefined): string {
  if (!ts) return '-';
  const date =
    typeof ts === 'string' ? new Date(ts) : new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HubDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 요청하지 않는다.
  const hubId = readRouteParam(params.id);

  const [hub, setHub] = useState<Hub | null>(null);
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchData = useCallback(async () => {
    if (!storeId || !token || !hubId) return;
    setLoading(true);
    try {
      const hubPath = `/stores/${apiPathSegment(storeId)}/hubs/${apiPathSegment(hubId)}`;
      const [hubData, ordersData] = await Promise.all([
        apiJson<Hub>(hubPath, token),
        apiJson<{ orders?: HubOrder[] }>(`${hubPath}/orders?status=HUB_ARRIVED`, token),
      ]);
      setHub(hubData);
      setOrders(ordersData.orders ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '네트워크 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, [storeId, token, hubId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const orderId = (o: HubOrder) => o.id ?? o.orderId ?? '';

  if (!hubId) {
    return (
      <PageShell>
        <PageHeader title="거점 상세" onBack={() => router.back()} />
        <div className={CONTAINER}>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            {INVALID_HUB_ADDRESS_MESSAGE}
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={hub ? hub.name : '거점 상세'}
        onBack={() => router.back()}
        right={
          hub ? (
            <ButtonLink
              render={<Link href={`/hubs/${encodeURIComponent(hubId)}/edit`} />}
              size="xs"
              variant="secondary"
              className="rounded-[8px]"
            >
              수정
            </ButtonLink>
          ) : undefined
        }
      />

      <div className={CONTAINER}>
        <div className="flex flex-col items-stretch justify-start gap-4">
          {error && (
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {error}
            </p>
          )}

          {loading ? (
            <LoadingState />
          ) : hub ? (
            <>
              {/* 거점 정보 카드 */}
              <div className={`${PAPER} p-4`}>
                <div className="flex flex-col items-stretch justify-start gap-2.5">
                  {/* ② 상태는 배지 면 대신 점 + 글자(2026-11-01 결정): 비활성=회색, 운영 중=검정. */}
                  <StatusDot
                    tone={hub.isActive ? 'default' : 'done'}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {hub.isActive ? '운영 중' : '비활성'}
                  </StatusDot>
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
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
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      운영시간: {hub.operatingHours}
                    </p>
                  )}
                </div>
              </div>

              {/* 픽업 대기 주문 목록 */}
              <div>
                <div className="mb-2.5 flex flex-row flex-wrap items-center justify-between gap-4">
                  <p
                    className={TEXT}
                    style={{
                      fontWeight: 'var(--fw-medium)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    픽업 대기 주문
                  </p>
                  <p
                    className={TEXT}
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                  >
                    {orders.length}건
                  </p>
                </div>

                {orders.length === 0 ? (
                  <div className={`${PAPER} px-4 py-10`}>
                    <div
                      className="flex flex-col items-center justify-start gap-4"
                      style={{ color: 'var(--color-text-disabled)' }}
                    >
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                      <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                        픽업 대기 주문이 없습니다
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-stretch justify-start gap-3">
                    {orders.map((order) => (
                      <button
                        type="button"
                        key={orderId(order)}
                        className={`${PAPER} p-4`}
                        onClick={() =>
                          router.push(
                            `/hubs/${encodeURIComponent(hubId)}/pickup?orderId=${encodeURIComponent(orderId(order))}`,
                          )
                        }
                        style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <div className="flex flex-row flex-wrap items-center justify-between gap-2.5">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mb-1 flex flex-row flex-wrap items-center justify-start gap-2.5">
                              <StatusDot size={13}>픽업 대기</StatusDot>
                              <p
                                className={TEXT}
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  color: 'var(--color-text-disabled)',
                                }}
                              >
                                {formatTime(order.createdAt)}
                              </p>
                            </div>
                            {order.items && order.items.length > 0 && (
                              <p
                                className={`${TEXT} truncate`}
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: 'var(--fw-medium)',
                                }}
                              >
                                {order.items[0].name}
                                {order.items.length > 1 && ` 외 ${order.items.length - 1}건`}
                              </p>
                            )}
                            <p
                              className={TEXT}
                              style={{
                                marginTop: 2,
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-disabled)',
                              }}
                            >
                              {order.totalAmount?.toLocaleString()}원
                            </p>
                          </div>
                          <div style={{ color: 'var(--color-text-disabled)' }}>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
