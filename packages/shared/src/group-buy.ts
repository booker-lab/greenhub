export type GroupBuyStatus = 'open' | 'full' | 'expired' | 'unavailable'

export interface GroupBuyProgress {
  currentQuantity: number
  targetQuantity: number
  recruitDeadline: string
}

/** 공동구매의 공개 모집 상태를 한 규칙으로 판정한다. */
export function getGroupBuyStatus(
  progress: GroupBuyProgress | null | undefined,
  now = Date.now(),
): GroupBuyStatus {
  if (!progress) return 'unavailable'
  if (progress.currentQuantity >= progress.targetQuantity) return 'full'

  const deadline = Date.parse(progress.recruitDeadline)
  if (!Number.isFinite(deadline) || deadline <= now) return 'expired'

  return 'open'
}
