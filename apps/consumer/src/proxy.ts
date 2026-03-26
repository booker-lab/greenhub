export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/mypage/:path*",
    "/cart",
    "/checkout/:path*",
    "/order/:path*",
  ],
};
