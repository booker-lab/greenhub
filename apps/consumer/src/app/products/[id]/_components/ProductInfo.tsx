import type { Product, Variety } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { HideOnErrorImage } from '@/components/ResilientImage';
import { isFeatureOn } from '@/lib/features';

const FRAGRANCE_LABEL: Record<string, string> = {
  none: '없음',
  light: '은은함',
  strong: '진함',
};
const BLOOM_LABEL: Record<string, string> = {
  bud: '봉오리',
  half: '반개화',
  full: '활짝 핌',
};
const CARE_LABEL: Record<string, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
};

interface Props {
  product: Product;
  variety: Variety | null;
  /** 분류·이름·원래 가격 묶음. 회차 상품은 회차 패널이 대신 보여주므로 false로 숨긴다. */
  showSummary?: boolean;
}

export default function ProductInfo({ product, variety, showSummary = true }: Props) {
  const isGroup = product.saleType === 'group';
  const headline = product.content?.headline ?? null;
  const description = product.content?.description ?? product.description ?? null;
  const displayColors = product.selection?.colors ?? product.colors ?? [];

  const careCards = [
    product.selection?.bloomCondition
      ? {
          icon: '🌸',
          label: '개화 상태',
          value: BLOOM_LABEL[product.selection.bloomCondition] ?? product.selection.bloomCondition,
        }
      : null,
    product.selection?.fragrance
      ? {
          icon: '💨',
          label: '향기',
          value: FRAGRANCE_LABEL[product.selection.fragrance] ?? product.selection.fragrance,
        }
      : null,
    product.selection?.careLevel
      ? {
          icon: '⭐',
          label: '관리 난이도',
          value: CARE_LABEL[product.selection.careLevel] ?? product.selection.careLevel,
        }
      : null,
  ].filter((c): c is { icon: string; label: string; value: string } => c !== null);

  // Mantine Stack(gap 0·px md·pt lg)·Text(16/1.55)·Title order 2(26px·줄 높이 1.35)·Badge sm·Divider(gray-3)·
  // Paper(radius md 8px·p md)·SimpleGrid(spacing xs 10px) 계산값
  return (
    <div className="flex flex-col gap-0 px-4 pt-5">
      {headline && (
        <p
          className="m-0 mb-2.5"
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-primary-dark)',
            lineHeight: 1.3,
          }}
        >
          {headline}
        </p>
      )}

      {showSummary && (
        <>
          <div className="mb-5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              {isGroup && <Badge size="sm">공동구매</Badge>}
              <Badge variant="secondary" size="sm">
                {product.category === 'cut_flower'
                  ? '절화'
                  : product.category === 'orchid'
                    ? '난'
                    : '관엽'}
              </Badge>
            </div>
            <h2
              className="m-0 text-[26px] leading-[1.35]"
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
            >
              {product.name}
            </h2>
            <p
              className="m-0 leading-[1.55]"
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {product.price.toLocaleString()}원
            </p>
          </div>

          <hr className="m-0 mb-5 h-0 border-0 border-t border-solid border-[#dee2e6]" />
        </>
      )}

      {careCards.length > 0 && (
        <div
          className="mb-4 rounded-[8px] p-4"
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(${careCards.length}, minmax(0, 1fr))` }}
          >
            {careCards.map(({ icon, label, value }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <p className="m-0 text-xl" style={{ lineHeight: 1 }}>
                  {icon}
                </p>
                <p
                  className="m-0 leading-[1.55]"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-text)',
                  }}
                >
                  {value}
                </p>
                <p
                  className="m-0 leading-[1.55]"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {product.varietyId && (
        <div className="mb-5">
          <p
            className="m-0 mb-3 leading-[1.55]"
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
            }}
          >
            상품 정보
          </p>
          <div className="flex flex-col gap-1.5">
            {(
              [
                variety ? ['품종', variety.name] : null,
                displayColors.length > 0 ? ['색상', displayColors.join(' · ')] : null,
                variety ? ['추천 관상 기간', variety.bloomDuration] : null,
                product.selection?.bundleUnit ? ['판매 단위', product.selection.bundleUnit] : null,
                product.selection?.stemType ? ['출하 형태', product.selection.stemType] : null,
              ] as ([string, string] | null)[]
            )
              .filter((r): r is [string, string] => r !== null)
              .map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-center justify-between gap-4"
                  style={{ borderBottom: '1px solid var(--color-surface-muted)', paddingBottom: 6 }}
                >
                  <p
                    className="m-0 leading-[1.55]"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {label}
                  </p>
                  <p
                    className="m-0 leading-[1.55]"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {value}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {description && (
        <p
          className="m-0 mb-5"
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.7,
            whiteSpace: 'pre-line',
          }}
        >
          {description}
        </p>
      )}

      {/* 상세 사진 정리(detail-images): 위 사진 넘김에 이미 나온 사진은 다시 보여주지 않는다. */}
      {(product.images?.length ?? 0) > 0 && !isFeatureOn('detail-images') && (
        <div className="-mx-4 mb-5">
          {product.images?.map((src, i) => (
            <HideOnErrorImage
              key={i}
              src={src}
              alt={`${product.name} 상세 ${i + 1}`}
              loading="lazy"
              style={{ width: '100%', display: 'block' }}
            />
          ))}
        </div>
      )}

      {displayColors.length > 0 && !(isFeatureOn('detail-images') && product.varietyId) && (
        <div className="mb-5 flex flex-wrap items-center gap-2.5" style={{ flexWrap: 'wrap' }}>
          {displayColors.map((color) => (
            // Mantine Badge radius="xl"(32px)
            <Badge key={color} variant="outline-gray" size="sm" className="rounded-[32px]">
              {color}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
