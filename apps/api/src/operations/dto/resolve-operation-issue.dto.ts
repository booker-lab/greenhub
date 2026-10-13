import { IsString, Matches, MaxLength } from 'class-validator';

export const OPERATION_ISSUE_RESOLVE_MEMO_MAX_LENGTH = 200;

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
