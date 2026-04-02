import { signIn } from "@/auth";

export default async function LoginPage() {

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-green-bg dark:bg-gray-900 px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-10">
        {/* 로고 */}
        <div className="text-center">
          <div className="w-20 h-20 bg-green-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-3xl font-bold">G</span>
          </div>
          <h1 className="text-2xl font-bold text-green-dark dark:text-green-light">
            Green Hub
          </h1>
          <p className="text-sm text-gray-500 mt-1">드라이버</p>
        </div>

        {/* 카카오 로그인 버튼 */}
        <form
          action={async () => {
            "use server";
            await signIn("kakao", { redirectTo: "/board" });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 bg-[#FEE500] hover:bg-[#F0D800] text-[#191919] font-semibold py-4 px-6 rounded-xl text-base transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919">
              <path d="M12 3C6.477 3 2 6.477 2 10.9c0 2.776 1.548 5.217 3.906 6.72l-.994 3.71a.25.25 0 00.375.274L9.43 19.28A11.6 11.6 0 0012 19.8c5.523 0 10-3.477 10-7.9S17.523 3 12 3z" />
            </svg>
            카카오로 시작하기
          </button>
        </form>
      </div>
    </div>
  );
}
