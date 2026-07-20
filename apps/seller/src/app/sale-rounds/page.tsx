'use client';

import type { SaleRound, SaleRoundSchedule, SaleRoundStatus } from '@greenhub/shared';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { AlertTriangle, CalendarDays, Copy, MapPin, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useSaleRounds } from '@/hooks/useSaleRounds';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS_META: Record<SaleRoundStatus, { label: string; color: string }> = {
  DRAFT: { label: '작성 중', color: 'gray' },
  SCHEDULED: { label: '판매 예정', color: 'blue' },
  OPEN: { label: '판매 중', color: 'green' },
  CLOSED: { label: '주문 마감', color: 'orange' },
  COMPLETED: { label: '배송 완료', color: 'teal' },
  CANCELLED: { label: '취소', color: 'red' },
};

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
    <Box>
      <Group justify="space-between" gap="xs" mb={6}>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {label}
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
          {ordered.toLocaleString()} / {limit.toLocaleString()}
        </Text>
      </Group>
      <Progress value={usage} size="sm" radius="xl" color={usage >= 100 ? 'red' : 'brand'} />
      {reserved > 0 && (
        <Text
          mt={5}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          결제 진행 중 {reserved.toLocaleString()} 추가 확보
        </Text>
      )}
    </Box>
  );
}

function RoundCard({ round, onCopy }: { round: SaleRound; onCopy: (round: SaleRound) => void }) {
  const status = STATUS_META[round.status];
  const hasHeldOrders = round.counters.heldOrderCount > 0;
  const cancellationNeedsAttention = round.cancellation?.status === 'LOCAL_FAILED';
  const requiresAttention = hasHeldOrders || cancellationNeedsAttention;

  return (
    <Paper data-testid={`sale-round-${round.id}`} radius="lg" shadow="xs" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            <Group gap="xs" mb={4}>
              <Badge color={status.color} variant="light">
                {status.label}
              </Badge>
              {round.closeReason && (
                <Badge color="gray" variant="outline">
                  {CLOSE_REASON_LABEL[round.closeReason]}
                </Badge>
              )}
            </Group>
            <Text style={{ fontWeight: 'var(--fw-bold)' }} lineClamp={2}>
              {round.name}
            </Text>
          </Box>
          <Button
            size="xs"
            variant="light"
            color="gray"
            leftSection={<Copy size={14} />}
            onClick={() => onCopy(round)}
            style={{ flexShrink: 0 }}
          >
            이전 회차 복사
          </Button>
        </Group>

        <Stack gap={6}>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <CalendarDays size={16} color="var(--color-text-disabled)" />
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              주문 {formatKstDate(round.schedule.orderOpenAt)} ~{' '}
              {formatKstDate(round.schedule.orderCloseAt)}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <MapPin size={16} color="var(--color-text-disabled)" />
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {round.deliveryRegion.enabled ? round.deliveryRegion.label : '배송 지역 비활성'}
            </Text>
          </Group>
        </Stack>

        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
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
        </SimpleGrid>

        <Group
          justify="space-between"
          gap="xs"
          p="sm"
          style={{
            borderRadius: 12,
            backgroundColor: requiresAttention
              ? 'var(--color-danger-surface)'
              : 'var(--color-surface-muted)',
          }}
        >
          <Box>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: requiresAttention ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              }}
            >
              배송 보류 {round.counters.heldOrderCount.toLocaleString()}건
            </Text>
            {cancellationNeedsAttention && (
              <Text
                mt={2}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                회차 취소 처리를 확인해 주세요
              </Text>
            )}
          </Box>
          {requiresAttention && (
            <Button
              component={Link}
              href="/orders?tab=ACTION_REQUIRED"
              size="xs"
              variant="subtle"
              color="red"
            >
              확인 필요 주문
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
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
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const copying = pendingOperation === 'copy';

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
      setCopySuccess(
        `"${copied.name}" 회차를 ${STATUS_META[copied.status].label} 상태로 복사했습니다.`,
      );
    } catch {
      // 훅이 검증된 오류 문구와 작업 상태를 관리한다.
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="판매 회차"
        right={
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="회차 다시 조회"
            disabled={loading}
            onClick={() => void refetch()}
          >
            <RefreshCcw size={18} />
          </ActionIcon>
        }
      />

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {copySuccess && (
            <Alert
              color="green"
              title="회차 복사 완료"
              withCloseButton
              onClose={() => setCopySuccess(null)}
            >
              {copySuccess}
            </Alert>
          )}

          {error && rounds.length > 0 && (
            <Alert
              color="red"
              title="최신 회차를 다시 확인하지 못했습니다"
              icon={<AlertTriangle size={18} />}
            >
              <Group justify="space-between" align="center">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
                <Button size="xs" variant="light" color="red" onClick={() => void refetch()}>
                  다시 조회
                </Button>
              </Group>
            </Alert>
          )}

          {loading && rounds.length === 0 && <LoadingState />}

          {!loading && error && rounds.length === 0 && (
            <Paper role="alert" radius="lg" shadow="xs" p="xl">
              <Stack align="center" gap="sm">
                <AlertTriangle size={36} color="var(--color-danger)" />
                <Text style={{ fontWeight: 'var(--fw-bold)' }}>
                  회차 목록을 불러오지 못했습니다
                </Text>
                <Text
                  ta="center"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {error}
                </Text>
                <Button variant="light" color="red" onClick={() => void refetch()}>
                  다시 조회
                </Button>
              </Stack>
            </Paper>
          )}

          {!loading && !error && rounds.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={48} strokeWidth={1.5} />}
              text="아직 등록된 판매 회차가 없습니다"
            />
          )}

          {rounds.map((round) => (
            <RoundCard key={round.id} round={round} onCopy={openCopyModal} />
          ))}
        </Stack>
      </Container>

      <Modal
        opened={copyForm !== null}
        onClose={closeCopyModal}
        title="이전 회차 복사"
        radius="lg"
        centered
        closeOnClickOutside={!copying}
        closeOnEscape={!copying}
      >
        {copyForm && (
          <Stack gap="md">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              상품·가격·한도와 주문 마감 이후 운영 간격은 그대로 복사합니다. 전체 일정과 상품은 복사
              후 편집 화면에서 확인해 주세요.
            </Text>
            <TextInput
              label="회차 이름"
              value={copyForm.name}
              onChange={(event) =>
                setCopyForm((current) =>
                  current ? { ...current, name: event.currentTarget.value } : current,
                )
              }
              disabled={copying}
              required
            />
            <TextInput
              label="주문 시작"
              type="datetime-local"
              value={copyForm.orderOpenAt}
              onChange={(event) =>
                setCopyForm((current) =>
                  current ? { ...current, orderOpenAt: event.currentTarget.value } : current,
                )
              }
              disabled={copying}
              required
            />
            <TextInput
              label="주문 마감"
              type="datetime-local"
              value={copyForm.orderCloseAt}
              onChange={(event) =>
                setCopyForm((current) =>
                  current ? { ...current, orderCloseAt: event.currentTarget.value } : current,
                )
              }
              disabled={copying}
              required
            />
            {(copyValidationError || operationError) && (
              <Alert color="red" title="회차를 복사할 수 없습니다">
                {copyValidationError ?? operationError}
              </Alert>
            )}
            <Group gap="xs">
              <Button
                flex={1}
                onClick={() => void handleCopy()}
                loading={copying}
                disabled={copying}
              >
                회차 복사
              </Button>
              <Button
                flex={1}
                variant="outline"
                color="gray"
                onClick={closeCopyModal}
                disabled={copying}
              >
                취소
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageShell>
  );
}
