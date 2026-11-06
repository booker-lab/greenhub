'use client';

// 실제 운영 방식(경매 당일 매입 → 이천 직배송)과 다른 표현을 쓰지 않는다.
const POINTS = [
  { icon: '🌿', title: '경매 당일 매입', desc: '월요일 경매에서 산 꽃을 매장에 쌓아 두지 않고 바로 준비합니다' },
  { icon: '🚚', title: '화요일 문 앞 배송', desc: '이천은 직접 배송해 화요일 오전 9시까지 문 앞에 둡니다' },
  { icon: '🔍', title: '농부가 고른 품질', desc: '8년차 난 농부가 꽃 상태를 직접 보고 고릅니다' },
];

// ① 외형 유지(UI 교체 P5): Mantine Box(위아래 xl 32·좌우 md 16)·Stack(gap md 16·4·sm 12)·
// Group(gap sm 12, wrap, 위 정렬)·Text(p, 16px·줄 높이 1.55, size xl은 20px)와 같은 값.
const TEXT = 'm-0 p-0 text-[16px] leading-[1.55]';

export default function GreenLoveBrandSection() {
  return (
    <div
      className="px-4 py-8"
      style={{
        background: 'var(--color-primary-surface)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="flex flex-col items-stretch justify-start gap-4">
        <div className="flex flex-col items-stretch justify-start gap-1">
          <p
            className={`${TEXT} uppercase`}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary-dark)',
            }}
          >
            Green Love
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            월요일 경매 당일 매입 → 화요일 문 앞 배송
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            8년차 난 농부가 직접 고른 싱싱한 꽃을 보내드립니다.
          </p>
        </div>

        <div className="flex flex-col items-stretch justify-start gap-3">
          {POINTS.map(({ icon, title, desc }) => (
            <div key={title} className="flex flex-row flex-wrap items-start justify-start gap-3">
              <p className="m-0 p-0 text-[20px]" style={{ lineHeight: 1 }}>
                {icon}
              </p>
              <div>
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-text)',
                  }}
                >
                  {title}
                </p>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
