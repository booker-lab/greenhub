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

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·안쪽 16; 그림자는 ② D2로 걷음)·Text(p, 여백 0)·
// Group(간격 10)·Stack 값. 안쪽 Text(span)는 Mantine처럼 16px·400으로 돌아간다.
const PAPER = 'block rounded-[16px] bg-card p-4';
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP = 'flex flex-row flex-wrap items-center justify-start gap-2.5';
// 선택 버튼: 한 줄에 똑같이 나누되(flex-1) 글자보다 좁아지지 않게 한다(min-w-fit). 자리가 모자라면 GROUP의
// flex-wrap으로 다음 줄로 내려간다. Button md의 좌우 22px·높이 42px 고정이면 휴대폰 폭(360·390)에서 버튼이
// 글자보다 좁아져(overflow-hidden이라 최소 폭 0) 글자가 잘렸고, 두 줄인 출하 형태는 위아래도 잘렸다.
// 좌우 여백은 8px로 줄이고 높이는 터치 영역 44px로 한다. 글자 크기는 그대로다.
// 한 줄 버튼은 높이를 고정한다(높이 auto면 글자 칸이 대문자 높이로 줄어 이모지 위아래가 잘린다).
// 두 줄인 출하 형태 버튼만 내용 높이에 맞춘다(STEM_BUTTON).
const OPTION_BUTTON = 'h-11 min-w-fit flex-1 px-2';
const STEM_BUTTON = 'h-auto min-h-11 min-w-fit flex-1 px-2 py-1';
const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-secondary)',
} as const;

// ② 디자인 방향(§3.2): 선택 표시는 초록 면 대신 흰 바탕 + 검정 1px 테두리 + 굵은 검정 글자(주문 선택 칩과 같은 규칙).
const activeStyle = {
  backgroundColor: 'var(--color-bg)',
  borderColor: 'var(--color-text)',
  color: 'var(--color-text)',
  fontWeight: 'var(--fw-bold)',
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
              className={STEM_BUTTON}
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
                      color: 'var(--color-text-secondary)',
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
          <span className={TEXT} style={{ color: 'var(--color-text-secondary)' }}>
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
                ...(value.colors.includes(color) ? activeStyle : {}),
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
              className={OPTION_BUTTON}
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
              className={OPTION_BUTTON}
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
              className={OPTION_BUTTON}
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
