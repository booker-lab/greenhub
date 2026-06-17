export type GroupBuyStatus =
  | 'missing_config'
  | 'recruiting'
  | 'target_reached'
  | 'deadline_closed'
  | 'failed_minimum'
  | 'invalid_config';

export interface GroupBuyStatusInput {
  currentQuantity?: number | null;
  minQuantity?: number | null;
  targetQuantity?: number | null;
  recruitDeadline?: string | Date | null;
}

export interface GroupBuyStatusResult {
  status: GroupBuyStatus;
  label: string;
  canParticipate: boolean;
  currentQuantity: number;
  minQuantity: number;
  targetQuantity: number;
  targetProgress: number;
  minimumProgress: number;
  remainingToTarget: number;
  remainingToMinimum: number;
  deadline: Date | null;
  isDeadlineClosed: boolean;
}

const statusLabels: Record<GroupBuyStatus, string> = {
  missing_config: '정보 확인 필요',
  recruiting: '모집 중',
  target_reached: '모집 완료',
  deadline_closed: '모집 종료',
  failed_minimum: '모집 실패',
  invalid_config: '정보 확인 필요',
};

function toQuantity(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : Number.NaN;
}

function toDeadline(value: string | Date | null | undefined) {
  if (!value) return null;
  const deadline = value instanceof Date ? value : new Date(value);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

function toProgress(current: number, base: number) {
  if (base <= 0) return 0;
  return Math.min((current / base) * 100, 100);
}

export function getGroupBuyStatus(
  input: GroupBuyStatusInput | null | undefined,
  now: Date = new Date(),
): GroupBuyStatusResult {
  const currentQuantity = toQuantity(input?.currentQuantity);
  const minQuantity = toQuantity(input?.minQuantity);
  const targetQuantity = toQuantity(input?.targetQuantity);
  const deadline = toDeadline(input?.recruitDeadline);

  const invalidQuantity =
    !Number.isFinite(currentQuantity) ||
    !Number.isFinite(minQuantity) ||
    !Number.isFinite(targetQuantity) ||
    currentQuantity < 0 ||
    minQuantity < 0 ||
    targetQuantity <= 0;

  if (!input) {
    return createResult('missing_config', 0, 0, 0, null, false);
  }

  if (invalidQuantity || !deadline) {
    return createResult(
      'invalid_config',
      Number.isFinite(currentQuantity) ? currentQuantity : 0,
      Number.isFinite(minQuantity) ? minQuantity : 0,
      Number.isFinite(targetQuantity) ? targetQuantity : 0,
      deadline,
      false,
    );
  }

  const isDeadlineClosed = deadline.getTime() <= now.getTime();
  if (!isDeadlineClosed && currentQuantity >= targetQuantity) {
    return createResult(
      'target_reached',
      currentQuantity,
      minQuantity,
      targetQuantity,
      deadline,
      isDeadlineClosed,
    );
  }
  if (!isDeadlineClosed) {
    return createResult(
      'recruiting',
      currentQuantity,
      minQuantity,
      targetQuantity,
      deadline,
      isDeadlineClosed,
    );
  }
  if (currentQuantity >= minQuantity) {
    return createResult(
      'deadline_closed',
      currentQuantity,
      minQuantity,
      targetQuantity,
      deadline,
      isDeadlineClosed,
    );
  }
  return createResult(
    'failed_minimum',
    currentQuantity,
    minQuantity,
    targetQuantity,
    deadline,
    isDeadlineClosed,
  );
}

function createResult(
  status: GroupBuyStatus,
  currentQuantity: number,
  minQuantity: number,
  targetQuantity: number,
  deadline: Date | null,
  isDeadlineClosed: boolean,
): GroupBuyStatusResult {
  return {
    status,
    label: statusLabels[status],
    canParticipate: status === 'recruiting',
    currentQuantity,
    minQuantity,
    targetQuantity,
    targetProgress: toProgress(currentQuantity, targetQuantity),
    minimumProgress: toProgress(currentQuantity, minQuantity),
    remainingToTarget: Math.max(targetQuantity - currentQuantity, 0),
    remainingToMinimum: Math.max(minQuantity - currentQuantity, 0),
    deadline,
    isDeadlineClosed,
  };
}
