import { Container } from '@mantine/core';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';

// 로그인이 필요한 화면은 요청마다 서버에서 만든다. proxy가 요청마다 만든 CSP nonce를 Next가
// 이 화면의 스크립트에 붙이려면 동적 렌더링이어야 한다(공개 화면은 정적이라 nonce를 쓰지 않는다).
export const dynamic = 'force-dynamic';

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
