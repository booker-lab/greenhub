'use client';

import {
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  classifyDriverOrderCommandError,
  readDriverOrderCommandErrorCodeFromResponse,
} from '../../_lib/driver-order-detail';

export type HoldReason =
  | 'WEATHER'
  | 'ACCESS_UNAVAILABLE'
  | 'ADDRESS_ISSUE'
  | 'CUSTOMER_UNREACHABLE';

export type DeliveryHold = {
  reasonCode: HoldReason;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  nextContactAt: string | null;
  nextDeliveryAt: string | null;
};

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  WEATHER: '기상 악화',
  ACCESS_UNAVAILABLE: '출입 불가',
  ADDRESS_ISSUE: '주소 오류',
  CUSTOMER_UNREACHABLE: '고객 연락 불가',
};

interface DeliveryHoldModalProps {
  opened: boolean;
  loading: boolean;
  orderId: string;
  storeId: string;
  // modal open 이후 authority 이동을 감지하기 위한 최소 prop. version이 아닌
  // 현재 order status만으로 hold command 허용 범위를 판정한다.
  orderStatus: string;
  onClose: () => void;
  onLoading: (loading: boolean) => void;
  onSaved?: () => void;
  // stale/403/409 수렴용 authoritative reread 트리거. 같은 hold command를
  // 자동 재전송하지 않고 parent의 fresh GET으로 수렴한다.
  onConvergence?: () => void;
  // ACK-uncertain(B/C/F/G/H) 수렴용 parent authoritative GET 트리거.
  // parent는 fresh GET 성공 전에는 warning으로 위험 command를 fail-closed하고,
  // modal은 닫혀 immediate same-hold resubmit을 차단한다. 자동 resend 없음.
  onUncertainConvergence?: () => void;
  // authority-loss 수렴용 parent clear 트리거. 401 또는 403 + AUTHORITY_DENIED는
  // modal 내부 표시로 끝나지 않고 parent가 protected order/PII를 즉시 제거하고
  // AUTH_ERROR로 전환하며 modal을 reset/close한다. 자동 resend 없음.
  onAuthorityLoss?: () => void;
  // absence/hiding 수렴용 parent clear 트리거. DRIVER_ORDER_NOT_FOUND code를
  // 직접 받으면 이전 protected order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다.
  onNotFound?: () => void;
}

// 배송 보류 command가 유효한 order authority 범위.
export const HOLD_COMMAND_ALLOWED_STATUSES = ['PREPARING', 'DELIVERING'] as const;

export function isHoldCommandAllowedStatus(status: string): boolean {
  return (HOLD_COMMAND_ALLOWED_STATUSES as readonly string[]).includes(status);
}

// 403 duplicate-sequential / 409 race-loser / stale-submit 공통 수렴 메시지.
// "실패했으니 다시 제출"이 아니라 상태 재확인을 안내한다.
export const HOLD_STALE_CONVERGENCE_MESSAGE =
  '이미 상태가 변경되었을 수 있습니다. 최신 상태를 다시 확인합니다.';

// HOLD ACK-uncertain(B/C/F/G/H) convergence contract (NO_RESEND + AUTHORITATIVE_GET).
// 같은 HOLD를 자동 재전송하지 않고 parent authoritative GET으로 수렴한다.
// same-command resend 유도 copy를 쓰지 않는다.
export const HOLD_UNCERTAIN_CONVERGENCE_MESSAGE =
  '보류 명령이 처리되었는지 확실하지 않습니다. 최신 상태를 다시 확인합니다. 같은 보류를 바로 다시 보내지 마세요.';
export const HOLD_UNCERTAIN_READBACK_WARNING =
  '보류 명령 결과를 확인하지 못했습니다. 상태를 다시 확인해 주세요. 같은 보류를 바로 다시 보내지 마세요.';

export function DeliveryHoldModal({
  opened,
  loading,
  orderId,
  storeId,
  orderStatus,
  onClose,
  onLoading,
  onSaved,
  onConvergence,
  onUncertainConvergence,
  onAuthorityLoss,
  onNotFound,
}: DeliveryHoldModalProps) {
  const { data: session } = useSession();
  const [reasonCode, setReasonCode] = useState<HoldReason>('WEATHER');
  const [reasonMessage, setReasonMessage] = useState('');
  const [customerResponsible, setCustomerResponsible] = useState(false);
  const [redeliveryFee, setRedeliveryFee] = useState<string | number>('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [nextDeliveryAt, setNextDeliveryAt] = useState('');
  const [error, setError] = useState('');
  const isWeather = reasonCode === 'WEATHER';
  // C3: 부모 loading state와 무관한 로컬 submitting guard. 동일 frame
  // double-submit에서도 두 번째 PATCH를 dispatch하지 않는다.
  const submittingRef = useRef(false);

  function resetHoldFormFields() {
    setReasonCode('WEATHER');
    setReasonMessage('');
    setCustomerResponsible(false);
    setRedeliveryFee('');
    setNextContactAt('');
    setNextDeliveryAt('');
  }

  // modal open 이후 order authority가 command 허용 범위를 벗어나면 stale form을
  // 남기지 않는다. parent가 이미 fresh authority를 들고 있으므로 별도 reread 없이
  // reset 후 닫는다. submit 경로의 stale 가드와 403/409 수렴이 실제 dispatch를 막는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opened·orderStatus만의 의도적 stale 감시이며 onClose는 parent setter다
  useEffect(() => {
    if (opened && !isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError('');
      onClose();
    }
  }, [opened, orderStatus]);

  function changeReason(value: string) {
    const next = value as HoldReason;
    setReasonCode(next);
    if (next === 'WEATHER') {
      setCustomerResponsible(false);
      setRedeliveryFee('');
    }
  }

  async function submit() {
    // C3: 진행 중인 submit이 있으면 두 번째 PATCH를 dispatch하지 않는다.
    if (submittingRef.current) return;
    // modal open 이후 authority가 이동했다면 stale form을 그대로 submit하지 않는다.
    // dispatch 0회, form reset, convergence reread 유도 후 닫는다.
    if (!isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError(HOLD_STALE_CONVERGENCE_MESSAGE);
      onConvergence?.();
      onClose();
      return;
    }
    const message = reasonMessage.trim();
    const token = session?.user.accessToken;
    if (!message) {
      setError('보류 사유를 입력해주세요.');
      return;
    }
    if (isWeather && !nextDeliveryAt) {
      setError('기상 보류의 새 배송 예정 시각을 입력해주세요.');
      return;
    }
    if (!token) {
      setError('인증 정보를 확인할 수 없습니다.');
      return;
    }
    const fee = typeof redeliveryFee === 'number' ? redeliveryFee : Number(redeliveryFee);
    const deliveryHold = {
      reasonCode,
      reasonMessage: message,
      customerResponsible: isWeather ? false : customerResponsible,
      redeliveryFee: isWeather || !Number.isFinite(fee) || fee <= 0 ? null : fee,
      nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
      nextDeliveryAt: nextDeliveryAt ? new Date(nextDeliveryAt).toISOString() : null,
    };

    setError('');
    submittingRef.current = true;
    onLoading(true);
    try {
      const response = await apiFetch(`/stores/${storeId}/orders/${orderId}/delivery-hold`, token, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryHold }),
      });
      if (!response.ok) {
        // 401은 envelope code와 무관하게 authority loss다. modal 내부 표시로
        // 끝나지 않고 parent clear + AUTH_ERROR + modal reset/close로 수렴한다.
        if (response.status === 401) {
          resetHoldFormFields();
          setError('로그인 정보를 다시 확인해 주세요.');
          onAuthorityLoss?.();
          onClose();
          return;
        }
        // error-code aware hold recovery: envelope code를 안전하게 읽는다.
        // body 파싱 실패는 null이며 그 자체가 same-hold resend를 유도하지 않는다.
        const errorCode = await readDriverOrderCommandErrorCodeFromResponse(response);
        const recovery = classifyDriverOrderCommandError({
          status: response.status,
          code: errorCode,
        });
        // 403 + AUTHORITY_DENIED (및 unknown/missing-code 403 fail-closed):
        // stale/state convergence로 오분류하지 않고 authority-loss 경로로 보낸다.
        // parent가 protected data를 즉시 제거하므로 modal 내부 표시에 그치지 않는다.
        if (recovery === 'AUTHORITY_LOSS') {
          resetHoldFormFields();
          setError('로그인 정보를 다시 확인해 주세요.');
          onAuthorityLoss?.();
          onClose();
          return;
        }
        // 403/409 + STATE_CONFLICT: authority loss로 오분류하지 않는다.
        // 같은 hold를 자동 재전송하지 않고 convergence path로 보낸다.
        if (recovery === 'STATE_CONFLICT') {
          resetHoldFormFields();
          setError(HOLD_STALE_CONVERGENCE_MESSAGE);
          onConvergence?.();
          return;
        }
        // DRIVER_ORDER_NOT_FOUND: authoritative absence/hiding. 이전 protected
        // order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다. 자동 resend 없음.
        if (recovery === 'NOT_FOUND') {
          resetHoldFormFields();
          setError('주문을 찾을 수 없습니다.');
          onNotFound?.();
          onClose();
          return;
        }
        // F/G: 403/409 STATE·AUTHORITY·NOT_FOUND 이외 4xx·5xx ACK-uncertain.
        // 같은 HOLD를 자동 재전송하지 않고 modal을 닫아 immediate resubmit을
        // 차단한 뒤 parent authoritative GET으로 수렴한다.
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      // B: 2xx이지만 malformed JSON 등으로 ACK 파싱 불가. 자동 resend 없이 GET 수렴한다.
      let result: { orderId?: unknown; status?: unknown };
      try {
        result = (await response.json()) as { orderId?: unknown; status?: unknown };
      } catch {
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      // C: 2xx이지만 ACK orderId/status mismatch. 자동 resend 없이 GET 수렴한다.
      if (result.orderId !== orderId || result.status !== 'DELIVERY_HELD') {
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      resetHoldFormFields();
      setError('');
      onClose();
      // Order 합성 없이 parent가 authoritative GET으로 수렴한다.
      onSaved?.();
    } catch {
      // H: network/transport error ACK-uncertain. 같은 HOLD를 자동 재전송하지 않고
      // modal을 닫아 immediate resubmit을 차단한 뒤 parent authoritative GET으로 수렴한다.
      resetHoldFormFields();
      setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
      onUncertainConvergence?.();
      onClose();
    } finally {
      submittingRef.current = false;
      onLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="배송 보류 기록" centered>
      <Stack gap="md">
        <Radio.Group label="보류 유형" value={reasonCode} onChange={changeReason}>
          <Stack gap="xs" mt="xs">
            {Object.entries(HOLD_REASON_LABEL).map(([value, label]) => (
              <Radio key={value} value={value} label={label} />
            ))}
          </Stack>
        </Radio.Group>
        <Textarea
          label="보류 사유"
          value={reasonMessage}
          onChange={(event) => setReasonMessage(event.currentTarget.value)}
          required
          autosize
          minRows={2}
        />
        <Checkbox
          label="고객 책임"
          checked={customerResponsible}
          disabled={isWeather}
          onChange={(event) => setCustomerResponsible(event.currentTarget.checked)}
        />
        <NumberInput
          label="재배송비"
          value={redeliveryFee}
          disabled={isWeather}
          min={0}
          step={1000}
          suffix="원"
          onChange={setRedeliveryFee}
        />
        <TextInput
          label="다음 연락 예정"
          type="datetime-local"
          value={nextContactAt}
          onChange={(event) => setNextContactAt(event.currentTarget.value)}
        />
        <TextInput
          label="새 배송 예정"
          type="datetime-local"
          value={nextDeliveryAt}
          onChange={(event) => setNextDeliveryAt(event.currentTarget.value)}
        />
        {error && <Text c="red">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button color="red" onClick={submit} loading={loading} disabled={loading}>
            배송 보류 저장
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
