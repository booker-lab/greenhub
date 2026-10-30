'use client';

import { COLOR_OPTIONS } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import { Input } from '@greenhub/ui/components/input';

const STEM_OPTIONS = [
  { value: '외대', label: '외대', desc: '1줄기' },
  { value: '쌍대', label: '쌍대', desc: '2줄기' },
  { value: '가지', label: '가지', desc: '다분지' },
  { value: '3대', label: '3대', desc: '3줄기' },
] as const;

const FRAGRANCE_OPTIONS = [
  { value: 'none', label: '없음', icon: '🚫' },
  { value: 'light', label: '은은', icon: '🌸' },
  { value: 'strong', label: '진함', icon: '💐' },
] as const;

const BLOOM_OPTIONS = [
  { value: 'bud', label: '봉오리', icon: '🌱' },
  { value: 'half', label: '반개화', icon: '🌷' },
  { value: 'full', label: '활짝', icon: '🌺' },
] as const;

const CARE_OPTIONS = [
  { value: 'easy', label: '쉬움', icon: '😊' },
  { value: 'normal', label: '보통', icon: '🌿' },
  { value: 'hard', label: '어려움', icon: '🌡️' },
] as const;

export interface SelectionForm {
  colors: string[];
  stemType: '외대' | '쌍대' | '가지' | '3대';
  fragrance: 'none' | 'light' | 'strong';
  bloomCondition: 'bud' | 'half' | 'full';
  careLevel: 'easy' | 'normal' | 'hard';
  bundleUnit: string;
}

interface Props {
  value: SelectionForm;
  onChange: (v: SelectionForm) => void;
  availableStemTypes?: string[];
}

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16)·Text(p, 여백 0)·
// Group(간격 10)·Stack 값. 안쪽 Text(span)는 Mantine처럼 16px·400으로 돌아간다.
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP = 'flex flex-row flex-wrap items-center justify-start gap-2.5';
const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-disabled)',
} as const;

const activeStyle = {
  backgroundColor: 'var(--color-primary)',
  borderColor: 'var(--color-primary)',
  color: 'white',
};

export default function TouchSelector({ value, onChange, availableStemTypes }: Props) {
  function set<K extends keyof SelectionForm>(key: K, val: SelectionForm[K]) {
    onChange({ ...value, [key]: val });
  }

  function toggleColor(color: string) {
    const colors = value.colors.includes(color)
      ? value.colors.filter((c) => c !== color)
      : [...value.colors, color];
    set('colors', colors);
  }

  const stemOptions = availableStemTypes
    ? STEM_OPTIONS.filter((o) => availableStemTypes.includes(o.value))
    : STEM_OPTIONS;

  return (
    <div className="flex flex-col gap-3">
      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          출하 형태
        </p>
        <div className={GROUP}>
          {stemOptions.map(({ value: v, label, desc }) => (
            <Button
              key={v}
              onClick={() => set('stemType', v as SelectionForm['stemType'])}
              className="flex-1"
              size="md"
              variant="outline-gray"
              style={value.stemType === v ? activeStyle : {}}
            >
              <ButtonLabel>
                <div className="flex flex-col items-center justify-start gap-0">
                  <p
                    className={TEXT}
                    style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
                  >
                    {label}
                  </p>
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: value.stemType === v ? 'white' : 'var(--color-text-disabled)',
                    }}
                  >
                    {desc}
                  </p>
                </div>
              </ButtonLabel>
            </Button>
          ))}
        </div>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          색상{' '}
          <span className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
            (복수 선택 가능)
          </span>
        </p>
        <div className={GROUP} style={{ flexWrap: 'wrap' }}>
          {COLOR_OPTIONS.map((color) => (
            <Badge
              key={color}
              render={<button type="button" />}
              onClick={() => toggleColor(color)}
              variant="outline-gray"
              style={{
                cursor: 'pointer',
                backgroundColor: value.colors.includes(color)
                  ? 'var(--color-primary-surface)'
                  : undefined,
                color: value.colors.includes(color) ? 'var(--color-primary-dark)' : undefined,
                borderColor: value.colors.includes(color) ? 'var(--color-primary)' : undefined,
              }}
            >
              {color}
            </Badge>
          ))}
        </div>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          향기
        </p>
        <div className={GROUP}>
          {FRAGRANCE_OPTIONS.map(({ value: v, label, icon }) => (
            <Button
              key={v}
              onClick={() => set('fragrance', v as SelectionForm['fragrance'])}
              className="flex-1"
              size="md"
              variant="outline-gray"
              style={value.fragrance === v ? activeStyle : {}}
            >
              <ButtonLabel>
                {icon} {label}
              </ButtonLabel>
            </Button>
          ))}
        </div>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          개화 상태
        </p>
        <div className={GROUP}>
          {BLOOM_OPTIONS.map(({ value: v, label, icon }) => (
            <Button
              key={v}
              onClick={() => set('bloomCondition', v as SelectionForm['bloomCondition'])}
              className="flex-1"
              size="md"
              variant="outline-gray"
              style={value.bloomCondition === v ? activeStyle : {}}
            >
              <ButtonLabel>
                {icon} {label}
              </ButtonLabel>
            </Button>
          ))}
        </div>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          관리 난이도
        </p>
        <div className={GROUP}>
          {CARE_OPTIONS.map(({ value: v, label, icon }) => (
            <Button
              key={v}
              onClick={() => set('careLevel', v as SelectionForm['careLevel'])}
              className="flex-1"
              size="md"
              variant="outline-gray"
              style={value.careLevel === v ? activeStyle : {}}
            >
              <ButtonLabel>
                {icon} {label}
              </ButtonLabel>
            </Button>
          ))}
        </div>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          판매 단위
        </p>
        <Input
          placeholder="예: 1분, 3묶음, 1박스"
          value={value.bundleUnit}
          onChange={(e) => set('bundleUnit', e.target.value)}
          size="md"
          className="rounded-xl"
        />
      </div>
    </div>
  );
}
