// 로그인이 필요한 화면은 요청마다 서버에서 만든다. proxy가 요청마다 만든 CSP nonce를 Next가
// 이 화면의 스크립트에 붙이려면 동적 렌더링이어야 한다(공개 화면은 정적이라 nonce를 쓰지 않는다).
export const dynamic = 'force-dynamic';

export default function ProtectedSegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
