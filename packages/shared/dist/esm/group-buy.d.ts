export type GroupBuyStatus = 'open' | 'full' | 'expired' | 'unavailable';
export interface GroupBuyProgress {
    currentQuantity: number;
    targetQuantity: number;
    recruitDeadline: string;
}
/** 공동구매의 공개 모집 상태를 한 규칙으로 판정한다. */
export declare function getGroupBuyStatus(progress: GroupBuyProgress | null | undefined, now?: number): GroupBuyStatus;
//# sourceMappingURL=group-buy.d.ts.map