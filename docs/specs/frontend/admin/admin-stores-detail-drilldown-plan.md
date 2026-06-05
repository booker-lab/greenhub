# 관리자 판매자 상세 드릴다운 계획

> 작업 ID: `ADMIN-STORES-T7`
> 작성일: 2026-06-03

## 목표

`/admin/stores` 목록에서 판매자별 운영 상태를 한 단계 더 들어가 확인할 수 있게 한다. 첫 범위는 읽기 전용 상세와 집계 요약으로 제한한다.

## 결정

- 상세 라우트는 seller 앱의 `/admin/stores/[id]`로 둔다.
- API는 `GET /admin/stores/:storeId/summary`를 신설한다.
- 응답은 스토어 문서, owner 기본 정보, 주문 상태별 건수, 총 주문 금액, 정산 상태별 건수, 플랫폼 수수료 합계, 실지급 합계를 포함한다.
- 목록 필터 복원은 상세 링크의 `back` 쿼리로 처리한다. 값이 없으면 `/admin/stores`로 돌아간다.
- 데이터 쓰기, 판매자 상태 변경, 주문·정산 개별 상세 진입은 범위에서 제외한다.

## API 계약

```ts
type AdminStoreSummaryResponse = {
  store: AdminStore;
  owner: { id: string; name?: string; email?: string; phone?: string } | null;
  orders: {
    totalCount: number;
    totalAmount: number;
    byStatus: Record<string, number>;
  };
  settlements: {
    totalCount: number;
    platformFee: number;
    netAmount: number;
    byStatus: Record<string, number>;
  };
};
```

## 검증

- API 단위 테스트로 스토어 없음 404, owner 조회, 주문·정산 집계 합산을 검증한다.
- seller 타입체크와 빌드로 상세 라우트와 훅 타입을 검증한다.
- 변경 파일 Biome을 통과한다.
