import type { OperationIssueType } from '@greenhub/shared';
import { IsString, Matches, MaxLength } from 'class-validator';

export const OPERATION_ISSUE_RESOLVE_MEMO_MAX_LENGTH = 200;

/**
 * 판매자가 직접 닫을 수 없고 관리자만 닫는 유형. 판매자 앱 `operations/manual-resolve.ts`가 같은 목록을 쓴다.
 * - PROVIDER_REVERSAL_DETECTED: 열려 있는 동안 그 주문의 정산 확정·지급을 막는다(settlements
 *   `provider-reversal-hold`). 정산을 받는 판매자가 스스로 풀 수 없게 한다.
 * - AUTO_REFUND_FAILED, FINALIZATION_REFUND_FAILED: 고객 환불이 끝났는지 확정되지 않은 기록이다.
 *   닫으면 돌려줘야 할 돈이 운영 화면에서 사라지므로 관리자가 환불 여부를 확인한 뒤 닫는다.
 */
export const ADMIN_ONLY_MANUAL_RESOLVE_TYPES: ReadonlySet<OperationIssueType> =
  new Set<OperationIssueType>([
    'PROVIDER_REVERSAL_DETECTED',
    'AUTO_REFUND_FAILED',
    'FINALIZATION_REFUND_FAILED',
  ]);

/**
 * 자동으로 닫히지 않는 운영 기록을 사람이 닫을 때의 본문.
 * 메모는 필수이고 운영 기록에 그대로 남으므로 짧은 한 줄 문자열만 받는다.
 */
export class ResolveOperationIssueDto {
  @IsString()
  @MaxLength(OPERATION_ISSUE_RESOLVE_MEMO_MAX_LENGTH)
  @Matches(/\S/, { message: '메모에는 공백이 아닌 문자가 있어야 합니다.' })
  @Matches(/^\P{Cc}*$/u, {
    message: '메모에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  })
  memo!: string;
}
