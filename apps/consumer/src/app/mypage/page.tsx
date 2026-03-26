import A2HSButton from "@/components/A2HSButton";

export default function MyPage() {
  return (
    <main className="p-4 space-y-6">
      <h1 className="text-xl font-bold">마이페이지</h1>
      <section>
        <h2 className="text-sm text-gray-500 mb-2">앱 설치</h2>
        <A2HSButton />
      </section>
    </main>
  );
}
