import type { PartnerInquiryItem } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { contactHref, formatInquiryDate } from '../_lib';

// 입점 문의 한 건: 농가·지역·받은 날·처리 상태, 누를 수 있는 연락처, 내용, 연락함 표시·삭제 버튼.

// ① 외형 유지(UI 교체 P2b): Mantine Paper(lg·xs·md)·Group·Text(기본 16px·1.55, sm 15px·1.45)·Badge light(radius sm)·
// Anchor·Button compact-sm(radius xl)과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const TEXT_SM = 'm-0 p-0 text-sm';

// 판매자 앱은 Mantine Anchor.css를 넣지 않아 Anchor가 Text(밑줄 없음) + 브라우저 기본 링크색이다. 그대로 둔다.
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
  return (
    <div className="block rounded-[16px] bg-white p-4 shadow-paper-xs">
      <div className="flex flex-row flex-nowrap items-center justify-between gap-2.5">
        {/* 휴대폰에서 긴 농가 이름이 날짜를 밀어내지 않게 한 줄 말줄임 */}
        <p
          className={`${TEXT} font-bold`}
          title={`${item.farmName} · ${item.region}`}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.farmName} · {item.region}
        </p>
        <div
          className="flex flex-row flex-nowrap items-center justify-start gap-1.5"
          style={{ flexShrink: 0 }}
        >
          <Badge variant={contacted ? 'light-green' : 'secondary'} className="rounded-[4px]">
            {contacted ? '연락함' : '미연락'}
          </Badge>
          <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
            {formatInquiryDate(item.createdAt)}
          </p>
        </div>
      </div>
      {href ? (
        <a
          href={href}
          className={`${TEXT_SM} mt-0.5 block no-underline`}
          style={{ overflowWrap: 'anywhere' }}
        >
          {item.contact}
        </a>
      ) : (
        <p className={`${TEXT_SM} mt-0.5`} style={{ overflowWrap: 'anywhere' }}>
          {item.contact}
        </p>
      )}
      <p className={`${TEXT_SM} mt-1`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {item.message}
      </p>
      <div className="mt-2 flex flex-row flex-wrap items-center justify-end gap-2.5">
        <Button
          variant={contacted ? 'plain' : 'light'}
          size="compact-sm"
          disabled={busy}
          onClick={onToggleContacted}
        >
          {contacted ? '연락 전으로 되돌리기' : '연락함으로 표시'}
        </Button>
        <Button variant="subtle-destructive" size="compact-sm" disabled={busy} onClick={onDelete}>
          삭제
        </Button>
      </div>
      {error && (
        <p role="alert" className={`${TEXT_SM} mt-1.5`} style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
