<!-- Language: ko -->

# 화훼 경매 시세 (Market Prices)

> 기준일: 2026-10-30 KST. 코드: `apps/api/src/market-prices`, 공개 타입: `packages/shared/src/market-price.types.ts`, 판매자 화면 계산: `apps/seller/src/lib/market-price.ts`.

aT 화훼공판장 경락가격을 매일 받아 저장하고, 판매자가 회차 가격을 정하거나 경매 구매 목록을 볼 때 상품 1개 기준 예상 매입가를 보여 준다. **판매자·관리자 전용**이며 손님 응답에는 넣지 않는다.

## 수집

- 출처: aT 화훼유통정보시스템 경락가격 OpenAPI(`kind=f001`). 요청 변수 `serviceKey`·`baseDate`(YYYY-MM-DD)·`flowerGubn`(1 절화, 2 관엽, 3 난, 4 춘란)·`dataType=json`.
- 환경 변수: `FLOWER_AUCTION_API_KEY`(없으면 수집하지 않음), `FLOWER_AUCTION_API_URL`(선택, 기본 `https://flower.at.or.kr/api/returnData.api`).
- 예약: `MarketPricesService.runScheduledIngest`, 매일 21:10 KST(`@Cron`, Cloud Scheduler 작업 이름 `market-prices-ingest`). 오늘 포함 최근 3일 × 4부류를 받아 같은 날·등급은 덮어쓴다. `jobLeases/market-prices-ingest`로 하루 한 번만 완료로 남기며, 일부 날·부류를 못 받으면 받은 만큼 저장하고 완료로 남기지 않는다.
- **응답 형식은 실제 응답으로 아직 확인하지 않았다.** 응답 항목 이름은 `flower-auction.client.ts`의 `RESPONSE_FIELDS`(`saleDate`·`pumName`·`goodName`·`lvNm`·`maxAmt`·`minAmt`·`avgAmt`·`totAmt`·`totQty`) 한 곳에 있다. 결과 코드가 정상이 아니거나, 줄 목록을 못 찾거나, 줄이 있는데 하나도 못 읽거나, 다른 경매일이 섞이거나, 1000줄이 꽉 차서 오면 그 날·부류는 저장하지 않고 실패한다. 0원·빈 시세를 저장하지 않는다. 첫 수집 뒤 로그(`[MarketPrices]`)로 행 수·실패를 확인한다.

## 저장 (서버 전용, `firestore.rules` 기본 거부)

| 컬렉션 | 문서 | 내용 |
|---|---|---|
| `marketPriceSeries` | `{flowerGubn}_{sha256(부류·품목·품종) 앞 32자}` | `flowerGubn`·`pumName`·`goodName`, `points[]`(`d` 경매일·`g` 등급·`avg`·`min`·`max`·`qty`·`amt`), `updatedAt`. 400일 넘은 점은 지운다. |
| `marketPriceCatalog` | `{flowerGubn}` | 수집된 품목·품종 이름 `items[]`(`pumName`·`goodNames[]`), `updatedAt` |

같은 날·같은 등급 줄이 여러 개면 물량 가중으로 합친다(평균 = 총금액 ÷ 총물량). 품종을 정하지 않은 조회는 `flowerGubn`·`pumName` 동등 조건 두 개라 복합 색인이 필요 없다.

## 상품 연결 (`products.marketRef`)

`ProductMarketRef`: `flowerGubn`, `pumName`, 선택 `goodName`(없으면 품목 전체), 선택 `grade`(없으면 전체 등급), `unitsPerItem`(상품 1개에 드는 경매 단위 수, 절화 1속·분화 1분 기준, 0.01~100, 소수 둘째 자리까지). 상품 만들기·고치기 본문으로 저장하고, 고치기에서 `null`은 연결을 지운다. 판매자 상세(`/owner`)에는 그대로 보이고 공개 상품 응답(allowlist)에는 없다.

## 조회 API (`seller`·`admin`, 판매자는 자기 가게만)

| 경로 | 설명 |
|---|---|
| `GET /stores/:storeId/market-prices?productIds=a,b` | 상품별 `MarketPriceSummary`. 연결이 없거나 다른 가게 상품이면 `null`. 최대 50개. |
| `GET /stores/:storeId/market-prices/catalog?flowerGubn=3` | `MarketCatalog`(연결 칸 자동 완성용) |
| `GET /stores/:storeId/market-prices/lookup?flowerGubn&pumName&goodName&grade&unitsPerItem` | 저장 전 연결 조건 미리 보기 |

`MarketPriceSummary`: `latest`(마지막 경매일), `recent`(서울 기준 오늘 포함 최근 28일, 물량 가중), `unitCost`(상품 1개 기준 = 경매 단가 × `unitsPerItem`), `grades`(연결한 품목·품종에서 거래된 등급).

## 판매자 화면

- 상품 등록·수정 마지막 단계의 "경매 시세 연결": 부류·품목·품종·등급·상품 1개당 단위 수, 미리 보기.
- 회차 양식의 회차 상품: 예상 매입가(최근 4주 평균, 없으면 마지막 경매일)와 회차 가격 차액. 회차 가격이 더 낮으면 경고한다. 저장을 막지는 않는다.
- 구매 목록 카드: 상품별 개당 예상 매입가·예상 금액과 합계. 시세 모르는 상품은 합계에서 빼고 수를 알린다.
