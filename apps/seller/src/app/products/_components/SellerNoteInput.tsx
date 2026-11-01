'use client';

import { Textarea } from '@greenhub/ui/components/textarea';

const MAX = 200;

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16)·Text(p, 여백 0) 값.
const TEXT = 'm-0 p-0 text-base font-normal';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SellerNoteInput({ value, onChange }: Props) {
  return (
    <div className="block rounded-[16px] bg-white p-4">
      <p
        className={`${TEXT} mb-1`}
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--color-text-disabled)',
        }}
      >
        판매자 메모
      </p>
      <p
        className={`${TEXT} mb-2.5`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        이 꽃의 특별한 점, 재배 환경, 수령 팁 등을 자유롭게 적어주세요. AI가 이 내용을 바탕으로 상세
        설명을 작성합니다.
      </p>
      <Textarea
        placeholder="예: 직접 키운 호접란입니다. 남향 베란다에서 3년째 관리 중이며 뿌리가 튼튼합니다..."
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX))}
        className="rounded-[8px]"
        style={{ fontSize: 'var(--font-size-md)', lineHeight: 1.6 }}
      />
      <p
        className={`${TEXT} mt-1 text-right`}
        style={{
          fontSize: 'var(--font-size-sm)',
          color: value.length >= MAX ? 'var(--color-danger)' : 'var(--color-text-disabled)',
        }}
      >
        {value.length} / {MAX}
      </p>
    </div>
  );
}
