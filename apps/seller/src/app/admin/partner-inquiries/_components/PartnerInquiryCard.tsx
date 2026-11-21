import type { PartnerInquiryItem } from '@greenhub/shared';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import {
  ADMIN_SUB,
  ADMIN_TEXT_ACTION,
  AdminRowMenu,
  type AdminRowMenuItem,
} from '../../_components/adminList';
import { contactHref, formatInquiryDate } from '../_lib';

// 입점 문의 한 건(design-direction.md §5 어드민 "모든 목록 화면의 규칙"): 그림자 없는 줄 목록 한 행.
// 왼쪽은 농가·지역(줄바꿈, 말줄임 없음)·누를 수 있는 연락처·내용, 오른쪽 열은 상태 점 + 글자·받은 날.
// 처리가 필요한 미연락 행에만 검정 밑줄 "연락함으로 표시"를 두고, 되돌리기·삭제는 행 끝 ⋮에 넣는다.
export interface PartnerInquiryCardProps {
  item: PartnerInquiryItem;
  busy: boolean;
  error: string | null;
  onToggleContacted: () => void;
  onDelete: () => void;
}

export function PartnerInquiryCard({
  item,
  busy,
  error,
  onToggleContacted,
  onDelete,
}: PartnerInquiryCardProps) {
  const contacted = item.contactedAt !== null;
  const href = contactHref(item.contact);
  const receivedAt = formatInquiryDate(item.createdAt);
  // 처리 중에는 메뉴 항목이 아무 일도 하지 않는다(버튼의 disabled와 같은 뜻).
  const guard = (action: () => void) => () => {
    if (!busy) action();
  };
  const menu: AdminRowMenuItem[] = [
    ...(contacted
      ? [{ key: 'uncontact', label: '연락 전으로 되돌리기', onSelect: guard(onToggleContacted) }]
      : []),
    { key: 'delete', label: '삭제…', onSelect: guard(onDelete) },
  ];
  return (
    // 데스크톱·태블릿: [농가·연락처·내용 | 상태·날짜·버튼 | ⋮] 세 칸. 휴대폰(≤640): 내용은 행 전체 폭으로 내린다.
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 border-b border-rule py-3 [word-break:keep-all]">
      <div className="col-start-1 row-start-1 min-w-0">
        <p className="m-0 text-[15px] leading-[22px] font-bold">
          {item.farmName} · {item.region}
        </p>
        {href ? (
          <a
            href={href}
            className="block text-[15px] leading-[22px] text-foreground underline underline-offset-4 [overflow-wrap:anywhere]"
          >
            {item.contact}
          </a>
        ) : (
          <p className="m-0 text-[15px] leading-[22px] [overflow-wrap:anywhere]">{item.contact}</p>
        )}
      </div>
      <div className="col-start-1 row-start-2 min-w-0 max-[640px]:col-span-3 max-[640px]:row-start-3">
        <p className="m-0 mt-1 text-[15px] leading-[22px] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.message}
        </p>
        {error && (
          <p
            role="alert"
            className="m-0 mt-1 text-[13px] leading-[18px] text-[var(--color-danger)]"
          >
            {error}
          </p>
        )}
      </div>
      <div className="col-start-2 row-span-2 row-start-1 flex flex-col items-end text-right">
        <StatusDot tone={contacted ? 'done' : 'default'} size={13}>
          {contacted ? '연락함' : '미연락'}
        </StatusDot>
        {receivedAt && (
          <p className={`${ADMIN_SUB} whitespace-nowrap tabular-nums`}>{receivedAt}</p>
        )}
        {!contacted && (
          <button
            type="button"
            onClick={onToggleContacted}
            disabled={busy}
            className={ADMIN_TEXT_ACTION}
          >
            연락함으로 표시
          </button>
        )}
      </div>
      <div className="col-start-3 row-span-2 row-start-1">
        <AdminRowMenu label={`${item.farmName} 입점 문의`} items={menu} />
      </div>
    </div>
  );
}
