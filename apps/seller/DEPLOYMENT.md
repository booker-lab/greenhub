# Seller deployment notes

## 2026-08-23 production auth contract alignment

This file intentionally records the production rebuild that realigns the Seller app with the current Auth API contract.

- Seller Kakao callback must send `kakaoAccessToken` to `POST /auth/kakao-login`.
- The API validates that token server-side before resolving the Kakao identity.
- No Kakao provider/channel setting is changed by this rebuild.
- This note has no runtime behavior; placing it under `apps/seller/` intentionally makes the Seller Vercel project treat the commit as Seller-relevant instead of skipping it via the Ignored Build Step.
- A second Seller-only commit is used after the Consumer project catches up, so the Seller production build can acquire the Hobby-plan build slot without changing runtime behavior.
