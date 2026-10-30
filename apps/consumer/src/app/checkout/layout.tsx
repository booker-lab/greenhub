import { Container } from '@mantine/core';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';

// PG·카드사 입점 심사는 사업자 정보가 홈뿐 아니라 결제 화면에도 늘 보이길 요구한다.
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Container size="sm" px="md" pb="lg">
        <BusinessInfoFooter />
      </Container>
    </>
  );
}
