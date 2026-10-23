/**
 * 주소창 값(쿼리·경로 파라미터)을 API 경로 조각으로 쓰기 위한 형식 검사와 인코딩.
 *
 * 화면이 주소창에서 읽은 값을 그대로 API 경로에 끼우면, 값 안의 `/`·`..`·`?`·`#`·`\`가
 * 경로 구분자나 상위 경로로 해석되어(fetch가 URL을 정규화한다) 의도하지 않은 다른 API로
 * 요청이 나갈 수 있다. 그래서 경로에 끼우는 값마다
 *   1. 식별자 형식인지 확인하고(isSafeApiPathSegment),
 *   2. encodeURIComponent로 한 경로 조각 안에 가둔다(apiPathSegment).
 * 형식이 맞지 않으면 요청을 보내지 않는다. 화면은 readRouteParam 등으로 먼저 걸러 오류를 보여 준다.
 *
 * 판매자 앱과 기사 앱이 함께 쓴다
 * (소비자 앱 isSafeIdentifier 규칙에 `.`·`..` 거부를 더했다).
 */
/**
 * API 경로 한 조각으로 쓸 수 있는 식별자인지 판정한다.
 * 빈 값, 앞뒤 공백, 128자 초과, `/ ? # \`, 제어문자, `.` 한 글자, `..`를 포함한 값은 거부한다.
 */
export declare function isSafeApiPathSegment(value: unknown): value is string;
/** 형식이 맞지 않는 값으로 API 경로를 만들려 할 때 던진다. fetch 전에 실패하므로 요청은 나가지 않는다. */
export declare class InvalidApiPathSegmentError extends Error {
    constructor();
}
/**
 * 값을 검사한 뒤 encodeURIComponent로 인코딩해 API 경로 한 조각으로 돌려준다.
 * 예: `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/status`
 * 형식이 맞지 않으면 InvalidApiPathSegmentError를 던진다.
 */
export declare function apiPathSegment(value: unknown): string;
/**
 * 동적 경로 파라미터(useParams()·page params)를 식별자로 읽는다. 형식이 맞지 않으면 null.
 *
 * Next 16.4는 경로 파라미터를 퍼센트 인코딩된 형태로 넘긴다
 * (next/dist/client/route-params.js canonicalizeURLPart,
 * next/dist/shared/lib/router/utils/get-dynamic-param.js getParamValue).
 * 그래서 한 번 디코딩한 원래 식별자를 검사해 돌려준다. 디코딩할 수 없는 값과
 * 문자열이 아닌 값(캐치올 배열·undefined)도 null이다.
 * 경로에 다시 넣을 때는 apiPathSegment(API 요청)나 encodeURIComponent(화면 이동)로 인코딩한다.
 */
export declare function readRouteParam(value: unknown): string | null;
//# sourceMappingURL=api-path.d.ts.map