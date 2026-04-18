import type { GenerateContentParams } from '../ai.service';

const BLOOM_CONDITION_LABEL: Record<string, string> = {
  bud: '봉오리',
  half: '반개화',
  full: '활짝 핌',
};

const FRAGRANCE_LABEL: Record<string, string> = {
  none: '없음',
  light: '은은함',
  strong: '진함',
};

export function buildProductContentPrompt(params: GenerateContentParams): string {
  const { variety, selection, sellerNote } = params;

  const guardrailSection = variety
    ? `
[가드레일 DB — 최우선 사실 정보]
- 품종명: ${variety.name}
- 향기: ${FRAGRANCE_LABEL[variety.fragranceLevel] ?? '정보 없음'}
- 추천 관상 기간: ${variety.bloomDuration}
- 관리 난이도: ${variety.careLevel === 'easy' ? '쉬움' : variety.careLevel === 'normal' ? '보통' : '어려움'}
- 특이사항: ${variety.notes || '없음'}
`
    : '[가드레일 DB] 품종 정보 없음 — 판매자 메모와 선택 데이터만 사용';

  const selectionSection = `
[판매자 터치 선택 데이터]
- 색상: ${selection.colors.join(', ') || '미선택'}
- 개화 상태: ${BLOOM_CONDITION_LABEL[selection.bloomCondition] ?? selection.bloomCondition}
- 향기: ${FRAGRANCE_LABEL[selection.fragrance] ?? selection.fragrance}
- 판매 단위: ${selection.bundleUnit || '미입력'}
`;

  const noteSection = sellerNote
    ? `[판매자 메모]\n${sellerNote}`
    : '[판매자 메모] 없음';

  return `당신은 화훼 농산물 직거래 플랫폼 '그린러브'의 상품 소개 문구 작성 전문가입니다.

아래 세 가지 정보를 조합하여 상품 소개 문구를 작성해주세요.

규칙:
1. 가드레일 DB의 사실과 배치되는 내용은 절대 작성하지 마세요.
2. 판매자 메모의 표현을 자연스럽고 따뜻한 문장으로 다듬어 주세요.
3. 어르신도 이해하기 쉬운 친근한 한국어로 작성하세요.
4. 과장이나 거짓 정보 없이 사실에 기반하여 작성하세요.
5. headline은 15자 이내의 짧고 인상적인 한 문장으로 작성하세요.
6. description은 2~4문장으로 상품의 매력을 자연스럽게 설명하세요.

${guardrailSection}
${selectionSection}
${noteSection}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
{"headline": "여기에 헤드라인", "description": "여기에 설명"}`;
}
