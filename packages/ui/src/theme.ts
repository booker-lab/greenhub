import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  parseThemeColor,
  type VariantColorsResolver,
} from '@mantine/core';

// 디자인 기준(docs/specs/frontend/design-standard.md) 프레시 그린. 6=면(버튼), 8=글자용 짙은 초록
const brand: MantineColorsTuple = [
  '#E9F9EF', // 0 - 연두(태그·상자 바탕)
  '#D2F2DF', // 1
  '#A6E5C0', // 2
  '#74D69E', // 3
  '#45C67F', // 4
  '#1FB86A', // 5
  '#00A65A', // 6 - primary
  '#008A4B', // 7
  '#007A43', // 8 - 글자용
  '#005C32', // 9
];

// 외곽선 버튼은 글자색이 테두리와 같은 주색(흰 바탕 대비 3.2:1)이라 글자만 짙은 초록으로 바꾼다.
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  if (input.variant !== 'outline') return colors;
  const parsed = parseThemeColor({
    color: input.color || input.theme.primaryColor,
    theme: input.theme,
  });
  if (parsed.isThemeColor && parsed.color === 'brand' && parsed.shade === undefined) {
    return { ...colors, color: 'var(--mantine-color-brand-8)' };
  }
  return colors;
};

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  defaultRadius: 16,
  focusRing: 'auto',
  variantColorResolver,
  headings: { fontWeight: '800' },
  components: {
    Button: {
      // 디자인 기준: 버튼은 완전히 둥글게
      defaultProps: { radius: 'xl' },
    },
    TextInput: {
      defaultProps: { radius: 16 },
    },
    Card: {
      defaultProps: { radius: 16, shadow: undefined, withBorder: true },
    },
  },
});
