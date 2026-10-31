// 가게 화면은 처음 열릴 때 만들어 CDN에 둔다(빌드 때 미리 만드는 가게는 없다). 가게 정보는
// 화면이 브라우저에서 읽으므로 서버 HTML에는 가게마다 다른 내용이 없다.
export async function generateStaticParams(): Promise<Array<{ storeId: string }>> {
  return [];
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
