"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupBuyStatus = getGroupBuyStatus;
/** 공동구매의 공개 모집 상태를 한 규칙으로 판정한다. */
function getGroupBuyStatus(progress, now = Date.now()) {
    if (!progress)
        return 'unavailable';
    if (progress.currentQuantity >= progress.targetQuantity)
        return 'full';
    const deadline = Date.parse(progress.recruitDeadline);
    if (!Number.isFinite(deadline) || deadline <= now)
        return 'expired';
    return 'open';
}
