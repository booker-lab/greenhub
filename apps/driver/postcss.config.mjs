// optimize: false — 운영 빌드에서 Tailwind의 lightningcss가 색을 짧게 다시 쓰지 않게 한다(판매자 앱과 같다).
// 켜 두면 rgba(0,0,0,0.05)가 #0000000d(알파 13/255)로 바뀌어 알림·시트 그림자가 dev와 운영 빌드에서
// 채널 최대 5 달라졌다(알림 toast-status-uncertain, 2026-10-31). 압축은 Next가 한다(값은 rgba 그대로 둔다).
export default {
  plugins: {
    '@tailwindcss/postcss': { optimize: false },
  },
};
