// 순서(UI 교체 P5 연결, 판매자 P2a와 같음): Tailwind가 먼저 globals.css의 @import(Mantine 포함)를 한 파일로 펼치고 layer로 감싼다.
// 그 뒤 Mantine 프리셋·변수가 펼쳐진 전체에 예전처럼 적용된다. 반대 순서면 Mantine 프리셋이 펼치기 전 파일만 본다.
// optimize: false — 운영 빌드에서 Tailwind의 lightningcss가 펼친 Mantine CSS까지 다시 쓰지 않게 한다.
// 압축은 예전처럼 Next가 한다. Tailwind 출력의 중첩 규칙은 Mantine 프리셋(postcss-nested)이 펼친다.
export default {
  plugins: {
    '@tailwindcss/postcss': { optimize: false },
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
};
