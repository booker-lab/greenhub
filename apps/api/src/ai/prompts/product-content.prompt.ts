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

const CATEGORY_GUIDE: Record<string, string> = {
  orchid: '관상 기간과 선물·경조사 용도를 중심으로 설명하세요.',
  cut_flower: '신선도와 보관 방법(물에 담그기, 서늘한 곳 보관 등)을 2문장에 포함하고, 꽃다발·화환 활용을 제안하세요.',
  plant: '햇빛·물 주기 등 간단한 관리법을 2문장에 포함하고, 공간 인테리어나 반려식물로서의 감성을 제안하세요.',
};

export function buildProductContentPrompt(params: GenerateContentParams): string {
  const { variety, selection, sellerNote, category } = params;
  const categoryGuide = CATEGORY_GUIDE[category ?? 'orchid'] ?? CATEGORY_GUIDE.orchid;

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
- 출하 형태: ${selection.stemType || '미선택'}
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
5. headline은 15자 이내로 작성하세요.
   - "~입니다", "~드립니다" 같은 딱딱한 종결어미는 사용하지 마세요.
   - "최고", "완벽", "특별" 등 근거 없는 수식어는 사용하지 마세요.
   - 상품명을 그대로 반복하지 마세요.
   - 색상·관상 기간·분위기 중 하나를 구체적으로 담아 명사형으로 마무리하세요.
   - 좋은 예: "오래도록 붉고 화사한 만천홍", "60일간 집을 밝혀줄 선물"
6. description은 반드시 아래 3문장 구조로 작성하고, 문장 사이에 줄바꿈(\\n)을 넣으세요.
   - 1문장: 꽃의 특징 (색상·형태·출하 형태)
   - 2문장: 관상 가치 (관상 기간·분위기)
   - 3문장: 활용 제안 (어떤 상황·누구에게 어울리는지)
7. 카테고리 지침: ${categoryGuide}

${guardrailSection}
${selectionSection}
${noteSection}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
{"headline": "여기에 헤드라인", "description": "1문장\\n2문장\\n3문장"}`;
}
