'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { type CreateSaleRoundInput, useSaleRounds } from '@/hooks/useSaleRounds';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { RoundForm } from '../[id]/RoundForm';
import { buildNewRoundTemplate } from './new-round.logic';

// ① 외형 유지(UI 교체 P4): Mantine Container(sm, 좌우·위아래 16px)·Stack(md 16px)·Alert·Text와 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';

const EMPTY_CARROT_LINKS = { representativeUrl: null, productLinks: [] } as const;

export default function NewSaleRoundPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const { products, loading, error, retry } = useStoreProducts(storeId);
  const { createRound, pendingOperation } = useSaleRounds();
  // 양식은 round가 바뀌면 입력을 초기화하므로 템플릿 기준 시각을 화면 진입 시점에 고정한다.
  const [openedAt] = useState(() => new Date());

  const storeProducts = useMemo(
    () => (storeId ? products.filter((product) => product.storeId === storeId) : []),
    [products, storeId],
  );
  const template = useMemo(
    () => (storeId ? buildNewRoundTemplate(storeProducts, storeId, openedAt) : null),
    [storeProducts, storeId, openedAt],
  );

  const onSave = async (input: CreateSaleRoundInput) => {
    const created = await createRound(input);
    router.replace(`/sale-rounds/${created.id}`);
  };

  return (
    <PageShell>
      <PageHeader title="새 회차 만들기" onBack={() => router.push('/sale-rounds')} />
      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!storeId || loading ? (
          <LoadingState />
        ) : error ? (
          <Alert variant="destructive" role="alert" icon={<AlertTriangle size={16} />}>
            <AlertTitle>스토어 상품을 불러오지 못했습니다</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col items-stretch justify-start gap-2.5">
                <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  {error}
                </p>
                <Button size="xs" variant="light-destructive" onClick={retry}>
                  다시 시도
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : template ? (
          <div className="flex flex-col items-stretch justify-start gap-4">
            <Alert variant="secondary" role="alert">
              <AlertTitle>기본값을 채워 두었습니다</AlertTitle>
              <AlertDescription>
                다음 회차 일정(일요일 밤 12시 주문 마감, 화요일 오전 9시까지 배송), 경기도 이천시,
                배송지 15곳·판매 수량 30개, 판매 중인 상품의 지금 가격을 미리 넣었습니다. 저장하면
                손님에게는 아직 보이지 않는 ‘작성 중’ 회차로 만들어집니다.
              </AlertDescription>
            </Alert>
            {storeProducts.length === 0 && (
              <Alert variant="warning" role="alert">
                <AlertTitle>현재 스토어 상품이 없습니다</AlertTitle>
                <AlertDescription>회차에 넣을 상품을 먼저 등록해 주세요.</AlertDescription>
              </Alert>
            )}
            <RoundForm
              round={template}
              products={storeProducts}
              carrotLinks={EMPTY_CARROT_LINKS}
              onSave={onSave}
              disabled={pendingOperation === 'create'}
            />
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
