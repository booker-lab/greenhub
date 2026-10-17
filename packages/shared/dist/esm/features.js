// 팔도감 벤치마킹 비교용 기능 토글.
//
// 각 기능은 하나의 키로 켜고 끈다. 키가 꺼져 있으면 화면과 동작은 기존과 같다.
// 앱은 빌드 시점 값(NEXT_PUBLIC_GREENHUB_FEATURES)을 parseFeatureFlags로 읽는다.
//   - 비어 있거나 없음: 모두 꺼짐(운영 기본값)
//   - "all": 모두 켜짐
//   - "guest-cart,reviews": 적은 키만 켜짐. 모르는 키는 무시한다.
// 비교가 끝나 남기기로 한 기능은 토글을 걷어내고, 빼기로 한 기능은 코드를 지운다.
export const FEATURE_KEYS = [
    // UX 개선
    'payment-fail-stay',
    'open-alert',
    'hide-empty-past',
    'countdown-date',
    'detail-images',
    'arrival-everywhere',
    'category-round-label',
    'guest-cart',
    'icheon-precheck',
    'order-success-guide',
    'reorder',
    'purchase-history',
    // 팔도감 적용 매트릭스
    'option-sheet',
    'seller-store',
    'quality-guarantee',
    'reviews',
    'card-discount',
    'size-info',
    'wishlist',
    'restock-alert',
    'gift',
    'cart-upsell',
    'product-request',
    'demand-signals',
    // 팔도감의 빈곳
    'plant-search',
    'care-guide',
    'recommendations',
    'partner-inquiry',
];
export const FEATURES = [
    { key: 'payment-fail-stay', group: 'ux', title: '결제 실패 화면 유지', summary: '결제가 취소돼도 4초 뒤 홈으로 보내지 않고 다시 결제하기를 누를 수 있게 둔다' },
    { key: 'open-alert', group: 'ux', title: '오픈 알림 받기', summary: '주문 시작 전 회차에서 카카오 채널 추가 버튼을 보여준다' },
    { key: 'hide-empty-past', group: 'ux', title: '빈 지난 회차 숨김', summary: '지난 회차가 없으면 홈의 지난 회차 칸을 감춘다' },
    { key: 'countdown-date', group: 'ux', title: '카운트다운 날짜 표기', summary: '하루 넘게 남으면 초 단위 대신 날짜와 시각으로 보여준다' },
    { key: 'detail-images', group: 'ux', title: '상세 사진 정리', summary: '첫 사진을 먼저 불러오고, 같은 사진과 색상 칩이 두 번 나오지 않게 한다' },
    { key: 'arrival-everywhere', group: 'ux', title: '도착 시각 표시', summary: '장바구니와 결제 요약에도 회차 도착 시각을 보여준다' },
    { key: 'category-round-label', group: 'ux', title: '상품 탭 회차 라벨', summary: '판매 예정 회차에 "이번 주 회차" 대신 "판매 예정"을 붙인다' },
    { key: 'guest-cart', group: 'ux', title: '비회원 장바구니', summary: '로그인 없이 장바구니를 보고, 주문할 때만 로그인한다' },
    { key: 'icheon-precheck', group: 'ux', title: '배송 지역 미리 확인', summary: '결제 전에 우리 집이 이천시 배송 지역인지 확인한다' },
    { key: 'order-success-guide', group: 'ux', title: '주문 완료 안내', summary: '주문 완료 화면에 실제 도착 날짜와 받는 방법, 다음 할 일을 보여준다' },
    { key: 'reorder', group: 'ux', title: '다시 주문하기', summary: '지난 주문의 상품이 이번 회차에 있으면 한 번에 다시 담는다' },
    { key: 'purchase-history', group: 'ux', title: '구매한 꽃', summary: 'MY에서 지금까지 산 꽃을 상품별로 모아 마지막 구매일과 구매 횟수를 보여준다' },
    { key: 'option-sheet', group: 'matrix', title: '옵션 시트', summary: '화분·문구 라벨·토퍼 같은 옵션을 아래에서 올라오는 시트에서 고르고, 문구는 직접 쓴다' },
    { key: 'seller-store', group: 'matrix', title: '판매자 소개', summary: '판매자 화면과 상세에 누가 골라 보내는지 판매자 소개를 보여준다' },
    { key: 'quality-guarantee', group: 'matrix', title: '품질 보장 라벨', summary: '보장 대상 상품에 라벨을 달고 보장 조건을 모아 보여준다' },
    { key: 'reviews', group: 'matrix', title: '후기·별점', summary: '배송 받은 주문에 후기를 남기고, 카드와 상세에 별점·후기 수를 보여준다' },
    { key: 'card-discount', group: 'matrix', title: '지난 회차 대비 가격', summary: '직전 마감 회차보다 싸게 팔면 카드와 상세에 "지난 회차보다 N원 내렸어요"를 보여준다' },
    { key: 'size-info', group: 'gap', title: '크기 정보', summary: '키·폭·화분 지름·꽃 송이 수를 상품 상세에서만 보여준다' },
    { key: 'wishlist', group: 'matrix', title: '이번 회차 찜', summary: '이번 회차 상품만 가볍게 찜하고, 회차가 끝나면 비운다. 다음 회차는 알림 신청으로 받는다' },
    { key: 'restock-alert', group: 'matrix', title: '다음 회차 알림 신청', summary: '품절·마감 상품에 다음 회차 알림을 신청한다(발송은 하지 않음)' },
    { key: 'gift', group: 'matrix', title: '선물하기', summary: '결제할 때 받는 분, 받는 분 연락처, 카드 문구를 칸마다 따로 적는다' },
    { key: 'cart-upsell', group: 'matrix', title: '장바구니 추가 제안', summary: '장바구니에 이번 회차의 다른 상품을 제안한다' },
    { key: 'product-request', group: 'matrix', title: '찾는 상품 제안', summary: '찾는 꽃이 없을 때 이름을 남기면 판매자가 모아 본다' },
    { key: 'demand-signals', group: 'matrix', title: '남은 수량·구매 수', summary: '판매자가 켜면 남은 수량과 이번 회차 구매 수를 보여준다' },
    { key: 'plant-search', group: 'gap', title: '식물 이름 검색', summary: '홈에 검색을 두고, 별칭·학명으로도 찾는다' },
    { key: 'care-guide', group: 'gap', title: '관리 안내 카드', summary: '물 주기·빛·온도·분갈이를 카드로 보여준다' },
    { key: 'recommendations', group: 'gap', title: '비슷한 꽃 추천', summary: '상세 아래에 같은 조건의 이번 회차 상품을 보여준다' },
    { key: 'partner-inquiry', group: 'gap', title: '입점 문의', summary: '푸터에서 농가·화원이 입점을 문의한다' },
];
const KNOWN = new Set(FEATURE_KEYS);
export function parseFeatureFlags(value) {
    const text = (value ?? '').trim();
    if (!text)
        return new Set();
    if (text === 'all')
        return new Set(FEATURE_KEYS);
    const keys = new Set();
    for (const raw of text.split(',')) {
        const key = raw.trim();
        if (KNOWN.has(key))
            keys.add(key);
    }
    return keys;
}
//# sourceMappingURL=features.js.map