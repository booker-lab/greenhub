// optimize: false — 운영 빌드에서 Tailwind의 lightningcss가 색을 짧게 다시 쓰지 않게 한다(판매자·기사 앱과 같다). 압축은 Next가 한다.
export default {
  plugins: {
    '@tailwindcss/postcss': { optimize: false },
  },
};
