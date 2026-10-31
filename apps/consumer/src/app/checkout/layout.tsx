import BusinessInfoFooter from '@/components/BusinessInfoFooter';

// PG·카드사 입점 심사는 사업자 정보가 홈뿐 아니라 결제 화면에도 늘 보이길 요구한다.
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Mantine Container size="sm" px="md" pb="lg": 최대 720px, 좌우 16px, 아래 20px, 가운데 정렬 */}
      <div className="mx-auto max-w-[720px] px-4 pb-5">
        <BusinessInfoFooter />
      </div>
    </>
  );
}
