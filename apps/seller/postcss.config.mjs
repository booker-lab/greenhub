// optimize: false — 운영 빌드에서 Tailwind의 lightningcss가 색을 짧게 다시 쓰지 않게 한다(기사 앱과 같다).
// 켜 두면 rgba(0,0,0,0.05) 같은 그림자 색이 #0000000d(알파 13/255)로 바뀌어 dev와 운영 빌드가 달라진다. 압축은 Next가 한다.
export default {
  plugins: {
    '@tailwindcss/postcss': { optimize: false },
  },
};
