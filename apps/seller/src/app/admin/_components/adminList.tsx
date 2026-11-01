import type { ReactNode } from 'react';

// 어드민 목록 화면 공통 규칙(design-direction.md §5 어드민 "모든 목록 화면의 규칙", §8 D7).
// - 머리: h1은 명사 하나(24px, 휴대폰 22px), 그 아래 15px 한 줄로 지금 기준을 쓴다.
// - 확인할 일 줄: 문제 상태가 있을 때만 1px 테두리 한 줄. 빨강은 건수 숫자에만, 줄은 칠하지 않는다.
// - 표: 줄무늬·머리 띠·그림자 없음. 머리글 13px 회색, 행 선 1px rule. 숫자는 오른쪽 정렬·tabular-nums.
// 폭 기준 클래스는 Tailwind가 소스 글자로 찾으므로 조합하지 않고 그대로 쓴다.

export function AdminPageHeader({
  title,
  subline,
  action,
}: {
  title: string;
  /** 지금 기준 한 줄(15px). */
  subline?: ReactNode;
  /** 이 화면의 주요 버튼(있을 때만). */
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] leading-[1.35] font-bold text-foreground min-[641px]:text-[24px]">
          {title}
        </h1>
        {subline && (
          <p className="m-0 mt-1 text-[15px] leading-[22px] text-[var(--color-text-secondary)] [word-break:keep-all]">
            {subline}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** 확인할 일 줄 — 문제 상태가 있을 때만 그린다. 숫자 강조는 호출 쪽에서 ProblemCount로 한다. */
export function AdminAttentionLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-4 rounded-[8px] border border-rule px-4 py-3 text-[15px] leading-[22px] text-foreground [word-break:keep-all]">
      {children}
    </p>
  );
}

export function ProblemCount({ children }: { children: ReactNode }) {
  return <span className="font-bold text-destructive tabular-nums">{children}</span>;
}

/** 표 머리글 칸(13px 회색, 띠 없음). */
export const ADMIN_TH =
  'border-b border-rule px-3 py-2.5 text-left text-[13px] leading-[18px] font-normal whitespace-nowrap text-[var(--color-text-secondary)]';
/** 표 칸(행 선 1px rule). */
export const ADMIN_TD = 'border-b border-rule px-3 py-3 align-top text-[15px] leading-[22px]';
/** 숫자 칸. */
export const ADMIN_NUM = 'text-right tabular-nums whitespace-nowrap';
/** 보조 줄(13px 회색). */
export const ADMIN_SUB = 'm-0 text-[13px] leading-[18px] text-[var(--color-text-secondary)]';

/** 처리가 필요한 행의 글자 버튼(검정 밑줄). 초록·빨강을 칠하지 않는다. */
export const ADMIN_TEXT_ACTION =
  'inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-[15px] font-bold whitespace-nowrap text-foreground underline underline-offset-4 disabled:cursor-not-allowed disabled:text-[var(--color-text-secondary)] disabled:no-underline';

/**
 * 목록의 개인정보 가림 — 이름은 첫 글자와 끝 글자만 남긴다(김*진, 이*, 남궁**훈).
 * 한 글자 이름은 그대로 둔다. 원문은 상세·확인창에서만 보여 준다.
 */
export function maskPersonName(name: string | null | undefined): string | null {
  const chars = Array.from(name?.trim() ?? '');
  if (chars.length === 0) return null;
  if (chars.length === 1) return chars[0];
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 금액 표기 — "48,000원". 0도 "0원"으로 쓴다. */
export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}
