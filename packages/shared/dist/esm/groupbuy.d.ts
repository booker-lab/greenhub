export type GroupBuyStatus = 'missing_config' | 'recruiting' | 'target_reached' | 'deadline_closed' | 'failed_minimum' | 'invalid_config';
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
export declare function getGroupBuyStatus(input: GroupBuyStatusInput | null | undefined, now?: Date): GroupBuyStatusResult;
//# sourceMappingURL=groupbuy.d.ts.map