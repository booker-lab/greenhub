'use client';

import type { SaleRound, SaleRoundSchedule, SaleRoundStatus } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Loader } from '@greenhub/ui/components/loader';
import { Progress } from '@greenhub/ui/components/progress';
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Copy,
  MapPin,
  Plus,
  RefreshCcw,
} from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useId, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useSaleRounds } from '@/hooks/useSaleRounds';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 상태 배지는 Mantine Badge light의 색(gray·yellow·brand·dark·red)과 같은 변형이다.
const STATUS_META: Record<
  SaleRoundStatus,
  {
    label: string;
    badge: 'secondary' | 'warning' | 'light' | 'light-dark' | 'destructive';
  }
> = {
  DRAFT: { label: '작성 중', badge: 'secondary' },
  SCHEDULED: { label: '판매 예정', badge: 'warning' },
  OPEN: { label: '판매 중', badge: 'light' },
  CLOSED: { label: '주문 마감', badge: 'light-dark' },
  COMPLETED: { label: '배송 완료', badge: 'secondary' },
  CANCELLED: { label: '취소', badge: 'destructive' },
};

// ① 외형 유지(UI 교체 P4): Mantine Paper·Text·Group·Stack·SimpleGrid·Progress·Modal·TextInput과 같은 값을
// Tailwind와 @greenhub/ui로 그린다. Text = p(16px·줄 높이 1.55·여백 0), Paper = 흰 바탕·모서리 16·그림자 xs,
// Group = 가로 flex(줄바꿈, 가운데 정렬), Stack = 세로 flex(늘임), 간격 xs 10·sm 12·md 16px.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-xs';
const ROW = 'flex flex-row flex-wrap items-center';
const COLUMN = 'flex flex-col items-stretch justify-start';
// Mantine Button loading(filled): 면색을 그대로 두고 글자를 숨긴 채, 흐린 흰 덮개 위 가운데에 흰 원(높이 ÷ 1.8)을 돌린다.
// datetime 입력칸은 Mantine 입력칸 줄 높이(높이 - 2px = 34px)를 준다. text-sm 1.45로 두면 날짜 글자가 소수점만큼 어긋난다.
const DATETIME_INPUT = 'leading-[34px]';
const FILLED_LOADING =
  "disabled:bg-primary disabled:text-white before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-xl before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";

const CLOSE_REASON_LABEL = {
  SCHEDULE_ENDED: '일정 마감',
  CAPACITY: '한도 마감',
  MANUAL: '수동 마감',
} as const;

const KST_DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface CopyFormState {
  source: SaleRound;
  name: string;
  orderOpenAt: string;
  orderCloseAt: string;
}

function formatKstDate(value: string) {
  return KST_DATE_FORMAT.format(new Date(value));
}

function toKstDateTimeInput(value: string) {
  return new Date(new Date(value).getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}

function addOneWeek(value: string) {
  return new Date(new Date(value).getTime() + ONE_WEEK_MS).toISOString();
}

function parseKstDateTimeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00+09:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCopiedSchedule(
  source: SaleRoundSchedule,
  orderOpenAtInput: string,
  orderCloseAtInput: string,
): SaleRoundSchedule | null {
  const orderOpenAt = parseKstDateTimeInput(orderOpenAtInput);
  const orderCloseAt = parseKstDateTimeInput(orderCloseAtInput);
  const sourceCloseAt = new Date(source.orderCloseAt).getTime();
  const auctionOffset = new Date(source.auctionAt).getTime() - sourceCloseAt;
  const deliveryStartOffset = new Date(source.deliveryStartAt).getTime() - sourceCloseAt;
  const deliveryEndOffset = new Date(source.deliveryEndAt).getTime() - sourceCloseAt;

  if (
    orderOpenAt === null ||
    orderCloseAt === null ||
    orderOpenAt >= orderCloseAt ||
    auctionOffset < 0 ||
    deliveryStartOffset < auctionOffset ||
    deliveryEndOffset <= deliveryStartOffset
  ) {
    return null;
  }

  return {
    orderOpenAt: new Date(orderOpenAt).toISOString(),
    orderCloseAt: new Date(orderCloseAt).toISOString(),
    auctionAt: new Date(orderCloseAt + auctionOffset).toISOString(),
    deliveryStartAt: new Date(orderCloseAt + deliveryStartOffset).toISOString(),
    deliveryEndAt: new Date(orderCloseAt + deliveryEndOffset).toISOString(),
    timezone: 'Asia/Seoul',
  };
}

function Metric({
  label,
  ordered,
  reserved,
  limit,
}: {
  label: string;
  ordered: number;
  reserved: number;
  limit: number;
}) {
  const used = ordered + reserved;
  const usage = Math.min(100, (used / limit) * 100);

  return (
    <div>
      <div className={`${ROW} mb-1.5 justify-between gap-2.5`}>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {label}
        </p>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
        >
          {ordered.toLocaleString()} / {limit.toLocaleString()}
        </p>
      </div>
      <Progress
        value={usage}
        className="h-[5px] rounded-[32px]"
        indicatorClassName={usage >= 100 ? 'bg-[#fa5252]' : undefined}
      />
      {reserved > 0 && (
        <p
          className={TEXT}
          style={{
            marginTop: 5,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
          }}
        >
          결제 진행 중 {reserved.toLocaleString()} 추가 확보
        </p>
      )}
    </div>
  );
}

function RoundCard({ round, onCopy }: { round: SaleRound; onCopy: (round: SaleRound) => void }) {
  const status = STATUS_META[round.status];
  const hasHeldOrders = round.counters.heldOrderCount > 0;
  const cancellationNeedsAttention = round.cancellation?.status === 'LOCAL_FAILED';
  const requiresAttention = hasHeldOrders || cancellationNeedsAttention;

  return (
    <div data-testid={`sale-round-${round.id}`} className={`${PAPER} p-4`}>
      <div className={`${COLUMN} gap-4`}>
        <div className="flex flex-row flex-nowrap items-start justify-between gap-4">
          <div style={{ minWidth: 0 }}>
            <div className={`${ROW} mb-1 justify-start gap-2.5`}>
              <Badge variant={status.badge}>{status.label}</Badge>
              {round.closeReason && (
                <Badge variant="outline-gray">{CLOSE_REASON_LABEL[round.closeReason]}</Badge>
              )}
            </div>
            <p className={`${TEXT} line-clamp-2`} style={{ fontWeight: 'var(--fw-bold)' }}>
              {round.name}
            </p>
          </div>
          <div className="flex flex-col items-end justify-start gap-1.5" style={{ flexShrink: 0 }}>
            <Button
              render={<Link href={`/sale-rounds/${encodeURIComponent(round.id)}`} />}
              nativeButton={false}
              size="xs"
              variant="light"
            >
              회차 열기
              <ChevronRight className="size-3.5" data-icon="inline-end" />
            </Button>
            <Button size="xs" variant="secondary" onClick={() => onCopy(round)}>
              <Copy className="size-3.5" data-icon="inline-start" />
              이전 회차 복사
            </Button>
          </div>
        </div>

        <div className={`${COLUMN} gap-1.5`}>
          <div className="flex flex-row flex-nowrap items-start justify-start gap-2.5">
            <CalendarDays size={16} color="var(--color-text-disabled)" />
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              주문 {formatKstDate(round.schedule.orderOpenAt)} ~{' '}
              {formatKstDate(round.schedule.orderCloseAt)}
            </p>
          </div>
          <div className="flex flex-row flex-nowrap items-start justify-start gap-2.5">
            <MapPin size={16} color="var(--color-text-disabled)" />
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {round.deliveryRegion.enabled ? round.deliveryRegion.label : '배송 지역 비활성'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 min-[36em]:grid-cols-2">
          <Metric
            label="주문 배송지"
            ordered={round.counters.orderedDeliveryAddresses}
            reserved={round.counters.reservedDeliveryAddresses}
            limit={round.limits.maxDeliveryAddresses}
          />
          <Metric
            label="판매 수량"
            ordered={round.counters.orderedItemQuantity}
            reserved={round.counters.reservedItemQuantity}
            limit={round.limits.maxItemQuantity}
          />
        </div>

        <div
          className={`${ROW} justify-between gap-2.5 p-3`}
          style={{
            borderRadius: 12,
            backgroundColor: requiresAttention
              ? 'var(--color-danger-surface)'
              : 'var(--color-surface-muted)',
          }}
        >
          <div>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: requiresAttention ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              }}
            >
              배송 보류 {round.counters.heldOrderCount.toLocaleString()}건
            </p>
            {cancellationNeedsAttention && (
              <p
                className={TEXT}
                style={{
                  marginTop: 2,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-danger)',
                }}
              >
                회차 취소 처리를 확인해 주세요
              </p>
            )}
          </div>
          {requiresAttention && (
            <Button
              render={<Link href="/orders?tab=ACTION_REQUIRED" />}
              nativeButton={false}
              size="xs"
              variant="subtle-destructive"
            >
              확인 필요 주문
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
export default function SaleRoundsPage() {
  const {
    rounds,
    loading,
    error,
    pendingOperation,
    operationError,
    refetch,
    copyRound,
    clearOperationError,
  } = useSaleRounds();
  const [copyForm, setCopyForm] = useState<CopyFormState | null>(null);
  const [copyValidationError, setCopyValidationError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<{ message: string; roundId: string } | null>(null);
  const copying = pendingOperation === 'copy';
  const copyFieldId = useId();

  const openCopyModal = (source: SaleRound) => {
    clearOperationError();
    setCopyValidationError(null);
    setCopySuccess(null);
    setCopyForm({
      source,
      name: `${source.name} 복사`,
      orderOpenAt: toKstDateTimeInput(addOneWeek(source.schedule.orderOpenAt)),
      orderCloseAt: toKstDateTimeInput(addOneWeek(source.schedule.orderCloseAt)),
    });
  };

  const closeCopyModal = () => {
    if (copying) return;
    clearOperationError();
    setCopyValidationError(null);
    setCopyForm(null);
  };

  const handleCopy = async () => {
    if (!copyForm) return;
    const name = copyForm.name.trim();
    const schedule = buildCopiedSchedule(
      copyForm.source.schedule,
      copyForm.orderOpenAt,
      copyForm.orderCloseAt,
    );
    if (!name) {
      setCopyValidationError('회차 이름을 입력해 주세요.');
      return;
    }
    if (!schedule) {
      setCopyValidationError('주문 시작은 마감보다 빨라야 하며 기존 운영 일정이 유지돼야 합니다.');
      return;
    }

    setCopyValidationError(null);
    try {
      const copied = await copyRound({
        sourceRoundId: copyForm.source.id,
        name,
        schedule,
      });
      setCopyForm(null);
      setCopySuccess({
        message: `"${copied.name}" 회차를 ${STATUS_META[copied.status].label} 상태로 복사했습니다.`,
        roundId: copied.id,
      });
    } catch {
      // 훅이 검증된 오류 문구와 작업 상태를 관리한다.
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="판매 회차"
        right={
          <div className="flex flex-row flex-nowrap items-center justify-start gap-2.5">
            <Button
              render={<Link href="/sale-rounds/new" />}
              nativeButton={false}
              size="xs"
              variant="light"
            >
              <Plus className="size-3.5" data-icon="inline-start" />새 회차
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-7"
              aria-label="회차 다시 조회"
              disabled={loading}
              onClick={() => void refetch()}
            >
              <RefreshCcw className="size-[18px]" />
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-[720px] px-4 py-4">
        <div className={`${COLUMN} gap-3`}>
          {copySuccess && (
            <Alert role="alert" onClose={() => setCopySuccess(null)} closeButtonLabel="닫기">
              <AlertTitle>회차 복사 완료</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col items-start justify-start gap-2.5">
                  <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {copySuccess.message}
                  </p>
                  <Button
                    render={
                      <Link href={`/sale-rounds/${encodeURIComponent(copySuccess.roundId)}`} />
                    }
                    nativeButton={false}
                    size="xs"
                    variant="light"
                  >
                    복사한 회차 열어 일정·상품 확인하기
                    <ChevronRight className="size-3.5" data-icon="inline-end" />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {error && rounds.length > 0 && (
            <Alert variant="destructive" role="alert" icon={<AlertTriangle size={18} />}>
              <AlertTitle>최신 회차를 다시 확인하지 못했습니다</AlertTitle>
              <AlertDescription>
                <div className={`${ROW} justify-between gap-4`}>
                  <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {error}
                  </p>
                  <Button size="xs" variant="light-destructive" onClick={() => void refetch()}>
                    다시 조회
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {loading && rounds.length === 0 && <LoadingState />}

          {!loading && error && rounds.length === 0 && (
            <div role="alert" className={`${PAPER} p-8`}>
              <div className="flex flex-col items-center justify-start gap-3">
                <AlertTriangle size={36} color="var(--color-danger)" />
                <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
                  회차 목록을 불러오지 못했습니다
                </p>
                <p
                  className={`${TEXT} text-center`}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {error}
                </p>
                <Button variant="light-destructive" onClick={() => void refetch()}>
                  다시 조회
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && rounds.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={48} strokeWidth={1.5} />}
              text="아직 등록된 판매 회차가 없습니다"
              action={
                <Button render={<Link href="/sale-rounds/new" />} nativeButton={false}>
                  <Plus className="size-4" data-icon="inline-start" />새 회차 만들기
                </Button>
              }
            />
          )}

          {rounds.map((round) => (
            <RoundCard key={round.id} round={round} onCopy={openCopyModal} />
          ))}
        </div>
      </div>

      <Dialog
        open={copyForm !== null}
        onOpenChange={(open) => {
          // 복사 중에는 바깥 누름·Esc로 닫지 않는다(closeCopyModal이 막는다).
          if (!open) closeCopyModal();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이전 회차 복사</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {copyForm && (
              <div className={`${COLUMN} gap-4`}>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  상품·가격·한도와 주문 마감 이후 운영 간격은 그대로 복사합니다. 전체 일정과 상품은
                  복사 후 편집 화면에서 확인해 주세요.
                </p>
                <Field>
                  <FieldLabel htmlFor={`${copyFieldId}-name`} required>
                    회차 이름
                  </FieldLabel>
                  <Input
                    id={`${copyFieldId}-name`}
                    value={copyForm.name}
                    onChange={(event) =>
                      setCopyForm((current) =>
                        current ? { ...current, name: event.currentTarget.value } : current,
                      )
                    }
                    disabled={copying}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${copyFieldId}-open`} required>
                    주문 시작
                  </FieldLabel>
                  <Input
                    id={`${copyFieldId}-open`}
                    type="datetime-local"
                    className={DATETIME_INPUT}
                    value={copyForm.orderOpenAt}
                    onChange={(event) =>
                      setCopyForm((current) =>
                        current ? { ...current, orderOpenAt: event.currentTarget.value } : current,
                      )
                    }
                    disabled={copying}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${copyFieldId}-close`} required>
                    주문 마감
                  </FieldLabel>
                  <Input
                    id={`${copyFieldId}-close`}
                    type="datetime-local"
                    className={DATETIME_INPUT}
                    value={copyForm.orderCloseAt}
                    onChange={(event) =>
                      setCopyForm((current) =>
                        current ? { ...current, orderCloseAt: event.currentTarget.value } : current,
                      )
                    }
                    disabled={copying}
                    required
                  />
                </Field>
                {(copyValidationError || operationError) && (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>회차를 복사할 수 없습니다</AlertTitle>
                    <AlertDescription>{copyValidationError ?? operationError}</AlertDescription>
                  </Alert>
                )}
                <div className={`${ROW} justify-start gap-2.5`}>
                  <Button
                    className={`flex-1 ${copying ? FILLED_LOADING : ''}`}
                    onClick={() => void handleCopy()}
                    disabled={copying}
                    data-loading={copying || undefined}
                  >
                    {copying && (
                      <span
                        aria-hidden
                        className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
                      >
                        <Loader
                          color="#ffffff"
                          style={
                            { '--loader-size': '20px', '--loader-border': '2.5px' } as CSSProperties
                          }
                        />
                      </span>
                    )}
                    회차 복사
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline-gray"
                    onClick={closeCopyModal}
                    disabled={copying}
                  >
                    취소
                  </Button>
                </div>
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
