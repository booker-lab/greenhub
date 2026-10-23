'use client';

import {
  apiPathSegment,
  type OrderStatus,
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_REASON_CODES,
  POST_DELIVERY_REFUND_REASON_LABEL,
  type PostDeliveryRefundReasonCode,
} from '@greenhub/shared';
import { Button, Group, Modal, Radio, Stack, Text, TextInput } from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  canSubmitPostDeliveryRefund,
  formatRefundDeadline,
  postDeliveryRefundBlockedMessage,
  type SellerRefundEligibility,
  shouldCheckPostDeliveryRefund,
} from '../post-delivery-refund';

interface PostDeliveryRefundSectionProps {
  storeId: string | null;
  orderId: string;
  status: OrderStatus;
  /** 환불이 끝난 뒤 주문 상세를 다시 불러온다. */
  onRefunded: () => void;
}

const smallText = { fontSize: 'var(--font-size-sm)' } as const;

/**
 * 배송 완료 주문의 "배송 후 환불" 버튼과 확인 창(계획서 R6).
 * 판매자는 배송 완료 7일까지·정산 지급 전까지만 직접 환불하고, 그 밖에는 관리자 문의 안내를 보여 준다.
 * 실제 허용 여부는 서버가 같은 규칙으로 다시 확인한다.
 */
export function PostDeliveryRefundSection({
  storeId,
  orderId,
  status,
  onRefunded,
}: PostDeliveryRefundSectionProps) {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? '';
  const [eligibility, setEligibility] = useState<SellerRefundEligibility | null>(null);
  const [opened, setOpened] = useState(false);
  const [reasonCode, setReasonCode] = useState<PostDeliveryRefundReasonCode | null>(null);
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basePath =
    storeId &&
    `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/post-delivery-refund`;
  const check = shouldCheckPostDeliveryRefund(status);

  useEffect(() => {
    if (!check || !basePath || !token) return;
    let cancelled = false;
    apiJson<SellerRefundEligibility>(basePath, token)
      .then((result) => {
        if (!cancelled) setEligibility(result);
      })
      .catch(() => {
        // 판단을 못 하면 버튼을 숨긴다(fail closed). 서버도 실행 때 다시 확인한다.
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [check, basePath, token]);

  const close = useCallback(() => {
    setOpened(false);
    setReasonCode(null);
    setMemo('');
    setError(null);
  }, []);

  async function submit() {
    if (!basePath || !canSubmitPostDeliveryRefund(reasonCode, memo)) return;
    setLoading(true);
    setError(null);
    try {
      await apiJson(basePath, token, {
        method: 'POST',
        body: JSON.stringify({ reasonCode, memo: memo.trim() }),
      });
      close();
      onRefunded();
    } catch (e) {
      setError(e instanceof Error ? e.message : '환불을 처리하지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  if (!check) {
    // 배송 중(DELIVERING·HUB_ARRIVED) 주문은 판매자가 취소·환불할 수 없다.
    return (
      <Text ta="center" py="xs" style={{ ...smallText, color: 'var(--color-text-disabled)' }}>
        배송 중입니다. 취소·환불이 필요하면 관리자에게 문의해 주세요.
      </Text>
    );
  }
  if (!eligibility) return null;

  if (!eligibility.eligible) {
    const message = postDeliveryRefundBlockedMessage(eligibility.reason);
    if (!message) return null;
    return (
      <Text ta="center" py="xs" style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
        {message}
      </Text>
    );
  }

  const deadline = formatRefundDeadline(eligibility.deadline);
  const amountText =
    eligibility.amount != null ? `${eligibility.amount.toLocaleString('ko-KR')}원` : '결제 금액';

  return (
    <>
      <Stack gap={6} py="xs">
        <Button
          onClick={() => setOpened(true)}
          fullWidth
          size="md"
          radius="xl"
          variant="outline"
          color="red"
        >
          배송 후 환불
        </Button>
        {deadline && (
          <Text ta="center" style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
            {deadline}까지 직접 환불할 수 있어요. 그 뒤는 관리자에게 문의해 주세요.
          </Text>
        )}
      </Stack>

      <Modal
        opened={opened}
        onClose={close}
        title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>배송 후 환불</Text>}
        radius="lg"
      >
        <Stack gap="sm">
          <Text style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
            손님에게 {amountText} 전액을 돌려주고 주문을 취소합니다. 되돌릴 수 없어요. 손님에게는
            카카오 알림톡으로 취소 안내가 갑니다.
          </Text>
          <Radio.Group
            label="환불 사유"
            value={reasonCode}
            onChange={(value) => setReasonCode(value as PostDeliveryRefundReasonCode)}
          >
            <Stack gap={6} mt={6}>
              {POST_DELIVERY_REFUND_REASON_CODES.map((code) => (
                <Radio key={code} value={code} label={POST_DELIVERY_REFUND_REASON_LABEL[code]} />
              ))}
            </Stack>
          </Radio.Group>
          <TextInput
            label="메모 (손님에게는 보이지 않아요)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={POST_DELIVERY_REFUND_MEMO_MAX_LENGTH}
            placeholder="예: 받은 날 꽃잎이 시들어 사진과 함께 연락 옴"
            radius="md"
          />
          {error && <Text style={{ ...smallText, color: 'var(--color-danger)' }}>{error}</Text>}
          <Group gap="xs">
            <Button
              onClick={submit}
              disabled={loading || !canSubmitPostDeliveryRefund(reasonCode, memo)}
              flex={1}
              color="red"
              radius="xl"
            >
              {loading ? '처리 중...' : '전액 환불 확정'}
            </Button>
            <Button onClick={close} flex={1} radius="xl" variant="outline" color="gray">
              닫기
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
