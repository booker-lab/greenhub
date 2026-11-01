'use client';

import type { SaleRound } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { ChevronRight, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { RoundPurchaseListCard } from '@/components/RoundPurchaseListCard';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ACTIVE_SELLER_ORDERS_QUERY, useOrders } from '@/hooks/useOrders';
import { readRoundDetail, type SellerSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { resolveStoreProductsView } from '@/hooks/useStoreProducts.recovery';
import { apiJson } from '@/lib/api';
import { aggregatePrep, type PrepLine } from '@/lib/prep';
import { isPurchaseListRound } from '@/lib/round-purchase-list';

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px)·Paper(radius lg = 16px; 그림자는 ② D2로 걷음)·
// Group·Stack·Text(p, 여백 0, 줄 높이 1.55)·UnstyledButton·Alert light(제목 있음)와 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';
const PAPER = 'block rounded-[16px] bg-white p-4';

function PrepRow({ line, index, accent }: { line: PrepLine; index: number; accent?: boolean }) {
  return (
    <div
      className="flex flex-row flex-nowrap items-center justify-between gap-4 py-2.5"
      style={index > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
    >
      <div
        className="flex flex-row flex-nowrap items-center justify-start gap-1.5"
        style={{ minWidth: 0 }}
      >
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {line.productName}
        </p>
        {line.selectionLabel && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({line.selectionLabel})
          </p>
        )}
      </div>
      <p
        className={TEXT}
        style={{
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          color: accent ? 'var(--color-danger)' : 'var(--color-text)',
          flexShrink: 0,
        }}
      >
        {line.quantity}개
      </p>
    </div>
  );
}

// 판매 중·주문 마감 회차의 구매 목록. 회차 상세를 직접 읽는다(회차 작업 잠금을 쓰지 않아
// 토큰 갱신으로 다시 읽을 때도 이전 읽기와 부딪히지 않는다).
function RoundPurchaseSection({ rounds, loading }: { rounds: SaleRound[]; loading: boolean }) {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const token = session?.user.accessToken ?? null;
  const [details, setDetails] = useState<SellerSaleRound[]>([]);
  const [failed, setFailed] = useState(false);
  const activeIds = useMemo(
    () => rounds.filter(isPurchaseListRound).map((round) => round.id),
    [rounds],
  );
  const activeKey = activeIds.join(',');

  useEffect(() => {
    if (!storeId || !token) return;
    let cancelled = false;
    const ids = activeKey ? activeKey.split(',') : [];
    void (async () => {
      const results = await Promise.allSettled(
        ids.map(async (id) =>
          readRoundDetail(
            await apiJson(
              `/stores/${encodeURIComponent(storeId)}/sale-rounds/${encodeURIComponent(id)}`,
              token,
            ),
            storeId,
            id,
          ),
        ),
      );
      if (cancelled) return;
      setDetails(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      );
      setFailed(results.some((result) => result.status === 'rejected'));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeKey, storeId, token]);

  if (loading || (activeIds.length === 0 && !failed)) return null;

  return (
    <div className="mb-4 flex flex-col gap-4">
      {failed && (
        <Alert variant="warning" role="alert">
          <AlertTitle>회차 구매 목록 일부를 불러오지 못했습니다</AlertTitle>
          <AlertDescription>회차 화면에서 다시 확인해 주세요.</AlertDescription>
        </Alert>
      )}
      {details.map((round) => (
        <div key={round.id}>
          <RoundPurchaseListCard round={round} title={`${round.name} 구매 목록`} />
          <div className="mt-1 flex flex-row flex-wrap items-center justify-end gap-4">
            <Link href={`/sale-rounds/${round.id}`} className={UNSTYLED_BUTTON}>
              <div className="flex flex-row flex-wrap items-center justify-start gap-0.5">
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  회차 보기
                </p>
                <ChevronRight size={14} color="var(--color-text-secondary)" />
              </div>
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PrepPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  // 준비 물량은 미발송(진행 중) 주문만 본다.
  const { orders, loading, error } = useOrders(storeId, ACTIVE_SELLER_ORDERS_QUERY);
  const {
    products,
    loading: productsLoading,
    error: productsError,
    retry: retryProducts,
    hasLoaded: productsHasLoaded,
  } = useStoreProducts(storeId);
  const { rounds, loading: roundsLoading } = useSaleRounds();
  // 회차 구매 목록이 보이면 아래 빈 안내가 회차 물량까지 없다는 뜻으로 읽히지 않게 고쳐 쓴다.
  const showsRoundPurchaseList = rounds.some(isPurchaseListRound);

  const { today, delayed } = useMemo(() => aggregatePrep(orders, products), [orders, products]);

  const productsView = resolveStoreProductsView({
    storeId,
    loading: productsLoading,
    error: productsError,
    productCount: products.length,
    hasLoaded: productsHasLoaded,
  });
  // 상품 첫 조회가 끝나기 전에는 준비 목록을 확정 0건처럼 표시하지 않는다.
  const isProductsConnecting = !!storeId && productsView === 'LOADING';
  const isConnecting = loading || isProductsConnecting || !firebaseReady;

  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const todayTotal = today.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <PageShell>
      <PageHeader
        title="준비 물량"
        right={
          <ConnectionStatus
            loading={loading}
            error={error}
            firebaseReady={firebaseReady}
            source="api"
          />
        }
      />

      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!!storeId && productsView === 'READ_FAILED' && !isConnecting && (
          <Alert variant="destructive" role="alert" className="mb-4">
            <AlertTitle>상품 정보를 불러오지 못했습니다</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-2.5">
                <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  준비 수량의 상품 이름이 &lsquo;상품 정보 없음&rsquo;으로 표시될 수 있습니다. 수량
                  자체는 주문 기준으로 집계됩니다.
                </p>
                <Button size="xs" variant="light-destructive" onClick={retryProducts}>
                  <RefreshCcw className="size-3.5" data-icon="inline-start" />
                  상품 다시 조회
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!!storeId && productsView === 'STALE' && !isConnecting && (
          <Alert variant="warning" role="alert" className="mb-4">
            <AlertTitle>최신 상품 정보를 확인하지 못했습니다</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-2.5">
                <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  이전 상품 이름으로 표시합니다. 준비 수량 자체는 주문 기준으로 집계됩니다.
                </p>
                {/* ② "이전 정보" 재조회는 노란 면 대신 중립 외곽선(2026-11-01 결정: 노랑은 마감에만). */}
                <Button size="xs" variant="outline-gray" onClick={retryProducts}>
                  <RefreshCcw className="size-3.5" data-icon="inline-start" />
                  상품 다시 조회
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <RoundPurchaseSection rounds={rounds} loading={roundsLoading} />

        {isConnecting && <LoadingState />}

        {!isConnecting &&
          today.length === 0 &&
          delayed.length === 0 &&
          (showsRoundPurchaseList ? (
            <p
              className={`${TEXT} py-4 text-center`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              회차 주문 외에는 오늘 준비할 물량이 없습니다
            </p>
          ) : (
            <EmptyState text="오늘 준비할 물량이 없습니다" />
          ))}

        {!isConnecting && (today.length > 0 || delayed.length > 0) && (
          <div className="flex flex-col gap-4">
            {today.length > 0 && (
              <div className={PAPER}>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}
                >
                  오늘 준비 물량 ({todayLabel})
                </p>
                <div className="mt-3">
                  {today.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} />
                  ))}
                </div>
                <div
                  className="flex flex-row flex-wrap items-center justify-end gap-4 pt-2.5"
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
                    {today.length}개 상품 · 총 {todayTotal}개
                  </p>
                </div>
              </div>
            )}

            {delayed.length > 0 && (
              // ② 문제 상자는 빨강 1px 테두리 대신 빨강 연한 면(design-direction §3.1·§3.2, 주문 우선순위 상자와 같은 규칙).
              <div className={PAPER} style={{ backgroundColor: 'var(--color-danger-surface)' }}>
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-danger)',
                  }}
                >
                  발송 지연 (배송일 경과)
                </p>
                <div className="mt-3">
                  {delayed.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} accent />
                  ))}
                </div>
                <Link
                  href="/orders?tab=ACTION_REQUIRED"
                  className={UNSTYLED_BUTTON}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    paddingTop: 10,
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    주문 관리에서 처리하기
                  </p>
                  <ChevronRight size={14} color="var(--color-text-secondary)" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
