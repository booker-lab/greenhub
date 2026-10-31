'use client';

import type { SaleRound } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useOrders } from '@/hooks/useOrders';
import { requestOrderStatusChange } from '@/hooks/useOrderStatusUpdate';
import {
  type BulkPrepareOutcome,
  buildRoundOrderStats,
  canBulkPrepare,
  countRoundOrders,
  filterRoundOrders,
  hasOrdersHiddenFromDriver,
  listBulkPrepareTargets,
  runBulkPrepare,
  summarizeBulkPrepare,
} from '@/lib/round-orders';

// ① 외형 유지(UI 교체 P4): Mantine Paper(lg·xs·md)·Stack(sm 12px)·Group·SimpleGrid(4칸·10px)·UnstyledButton·
// Text·Alert·Button과 같은 값을 Tailwind와 @greenhub/ui로 그린다.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

// 회차 상세 "이 회차 주문": 상태별 건수(누르면 그 주문 목록), 결제 완료 주문 한꺼번에 준비 시작,
// 마감 뒤에도 준비 시작 전 주문이 남으면 기사 화면에 안 보인다는 경고.
// 문구에 회차 상태 이름("판매 중"·"주문 마감"·"배송 완료")이나 "배송 보류"를 쓰지 않는다
// (회차 상세 E2E가 그 글자를 한 곳에서만 찾는다).
export function RoundOrdersSection({ round }: { round: Pick<SaleRound, 'id' | 'status'> }) {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const accessToken = session?.user.accessToken ?? null;
  const tokenRef = useRef<string | null>(accessToken);
  // 이 회차의 주문만 받는다(가게 전체 주문 이력을 받지 않는다).
  const { orders, loading, error, refresh } = useOrders(storeId, { roundId: round.id });

  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<BulkPrepareOutcome[] | null>(null);
  // 방금 준비 시작한 주문 — 목록을 다시 받기 전에 같은 주문을 또 보내지 않게 대상에서 뺀다.
  const [preparedIds, setPreparedIds] = useState<ReadonlySet<string>>(() => new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const roundOrders = useMemo(() => filterRoundOrders(orders, round.id), [orders, round.id]);
  const counts = useMemo(() => countRoundOrders(roundOrders), [roundOrders]);
  const stats = useMemo(() => buildRoundOrderStats(counts, round.id), [counts, round.id]);
  const targets = useMemo(
    () => listBulkPrepareTargets(roundOrders).filter((target) => !preparedIds.has(target.id)),
    [roundOrders, preparedIds],
  );

  const running = progress !== null;

  const startBulkPrepare = async () => {
    if (!storeId || running || targets.length === 0) return;
    const batch = targets;
    setConfirming(false);
    setOutcomes(null);
    setProgress({ done: 0, total: batch.length });
    const results = await runBulkPrepare(
      batch,
      (orderId) => {
        const token = tokenRef.current;
        if (!token) throw new Error('로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.');
        // 단건 상세의 회차 주문 준비 시작과 같은 요청(preparedAt 없이 PREPARING).
        return requestOrderStatusChange(storeId, orderId, token, 'PREPARING');
      },
      {
        onProgress: (done, total) => {
          if (mountedRef.current) setProgress({ done, total });
        },
        shouldContinue: () => mountedRef.current,
      },
    );
    if (!mountedRef.current) return;
    setPreparedIds((current) => {
      const next = new Set(current);
      for (const outcome of results) if (outcome.ok) next.add(outcome.id);
      return next;
    });
    setProgress(null);
    setOutcomes(results);
    refresh();
  };

  const summary = outcomes ? summarizeBulkPrepare(outcomes) : null;
  const showBulkButton = canBulkPrepare(round.status, targets.length);

  return (
    <div className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
      <div className="flex flex-col items-stretch justify-start gap-3">
        <div className="flex flex-row flex-wrap items-baseline justify-between gap-4">
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}
          >
            이 회차 주문
          </p>
          {!loading && (
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              총 {counts.total.toLocaleString()}건
            </p>
          )}
        </div>

        {loading && orders.length === 0 ? (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            주문을 불러오는 중…
          </p>
        ) : error && orders.length === 0 ? (
          <div className="flex flex-row flex-nowrap items-center justify-between gap-2.5">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              주문을 불러오지 못했어요.
            </p>
            <Button size="xs" variant="light" onClick={refresh}>
              다시 불러오기
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                최신 주문을 불러오지 못해 이전 건수를 보여 줘요.
              </p>
            )}
            {counts.total === 0 ? (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                아직 이 회차 주문이 없어요.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2.5">
                {stats.map((stat) => (
                  <Link
                    key={stat.key}
                    href={stat.href}
                    className={UNSTYLED_BUTTON}
                    aria-label={`${stat.label} ${stat.count.toLocaleString()}건 주문 보기`}
                    style={{
                      display: 'block',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-tag)',
                      background: 'var(--color-surface-muted)',
                    }}
                  >
                    <p
                      className={TEXT}
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 'var(--fw-bold)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {stat.label}
                    </p>
                    <p
                      className={TEXT}
                      style={{
                        marginTop: 2,
                        fontSize: 'var(--font-size-lg)',
                        fontWeight: 'var(--fw-extrabold)',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--color-text)',
                      }}
                    >
                      {stat.count.toLocaleString()}건
                    </p>
                  </Link>
                ))}
              </div>
            )}

            {hasOrdersHiddenFromDriver(round.status, targets.length) && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>기사 화면에 아직 안 보여요</AlertTitle>
                <AlertDescription>
                  결제 완료 {targets.length.toLocaleString()}건이 아직 준비 시작 전이에요. 준비
                  시작을 해야 기사 화면에 나와요.
                </AlertDescription>
              </Alert>
            )}

            {showBulkButton && (
              <div>
                <Button
                  className="w-full"
                  onClick={() => setConfirming(true)}
                  disabled={running || !storeId}
                >
                  {progress
                    ? `준비 시작 중… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}`
                    : `결제 완료 ${targets.length.toLocaleString()}건 모두 준비 시작`}
                </Button>
                <p
                  className={TEXT}
                  style={{
                    marginTop: 6,
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  경매로 사서 포장을 마친 뒤 눌러 주세요.
                </p>
              </div>
            )}
          </>
        )}

        {summary &&
          (summary.failed.length === 0 ? (
            <Alert role="status">
              <AlertTitle>준비 시작을 마쳤어요</AlertTitle>
              <AlertDescription>
                {summary.succeeded.toLocaleString()}건을 준비 시작했어요. 이제 기사 화면에 보여요.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" role="alert">
              <AlertTitle>일부 주문은 준비 시작을 못 했어요</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col items-stretch justify-start gap-1">
                  <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {summary.succeeded.toLocaleString()}건 성공,{' '}
                    {summary.failed.length.toLocaleString()}건 실패예요. 버튼을 다시 누르면 남은
                    주문만 다시 보내요.
                  </p>
                  <ul className="m-0 pl-4">
                    {summary.failed.map((outcome) => (
                      <li key={outcome.id}>
                        <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                          {outcome.label}: {outcome.error}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          ))}
      </div>

      <ConfirmModal
        opened={confirming}
        title="모두 준비 시작"
        message={`결제 완료 주문 ${targets.length.toLocaleString()}건을 한 건씩 준비 시작으로 바꿔요.\n주문마다 손님께 "상품 준비가 시작되었습니다" 알림톡이 한 번씩 가요.\n준비 시작한 주문은 기사 화면에 보여요.`}
        confirmLabel={`${targets.length.toLocaleString()}건 준비 시작`}
        confirmColor="brand"
        onConfirm={startBulkPrepare}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
