import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Image from "next/image";

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { user } = session;

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-4 pt-6 pb-4">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">내 정보</h1>
      </header>

      <main className="flex-1 px-4 space-y-4">
        {/* 프로필 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 flex items-center gap-4">
          {user.image ? (
            <Image
              src={user.image}
              alt="프로필"
              width={60}
              height={60}
              className="rounded-full"
            />
          ) : (
            <div className="w-[60px] h-[60px] rounded-full bg-green-pale flex items-center justify-center">
              <span className="text-green-primary font-bold text-xl">
                {user.name?.[0] ?? "D"}
              </span>
            </div>
          )}
          <div>
            <p className="font-bold text-gray-900 dark:text-gray-100">{user.name ?? "드라이버"}</p>
            <p className="text-sm text-gray-400">{user.email ?? ""}</p>
          </div>
        </div>

        {/* 계정 정보 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm text-gray-500">연결된 계정</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-[#FEE500] inline-block" />
              카카오
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm text-gray-500">앱 버전</span>
            <span className="text-sm text-gray-400">1.0.0</span>
          </div>
        </div>

        {/* 로그아웃 */}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full bg-white dark:bg-gray-800 text-red-500 font-semibold py-4 rounded-2xl border border-gray-100 dark:border-gray-700"
          >
            로그아웃
          </button>
        </form>
      </main>
    </div>
  );
}
