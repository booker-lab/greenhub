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
// 노랑 연한 변형(배지·안내 상자·연한 버튼)은 Mantine 기본 글자색이 주황 계열이라, 기준의 경고 토큰
// (노랑 연한 바탕 + 짙은 노랑 글자)으로 바꾼다. 디자인 기준은 주황을 쓰지 않는다.
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  if (input.variant !== 'outline' && input.variant !== 'light') return colors;
  const parsed = parseThemeColor({
    color: input.color || input.theme.primaryColor,
    theme: input.theme,
  });
  if (!parsed.isThemeColor || parsed.shade !== undefined) return colors;
  if (input.variant === 'outline' && parsed.color === 'brand') {
    return { ...colors, color: 'var(--mantine-color-brand-8)' };
  }
  if (input.variant === 'light' && parsed.color === 'yellow') {
    return {
      ...colors,
      background: 'var(--color-status-warning-bg)',
      hover: 'var(--color-status-warning-bg)',
      color: 'var(--color-status-warning-text)',
    };
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
  // Mantine size="xs"·"sm" 글자도 디자인 토큰(style.css)을 따른다. 지정하지 않으면 Mantine 기본값
  // (xs 12px·sm 14px)이 쓰여 본문 15px 기준보다 작아진다.
  fontSizes: {
    xs: 'var(--font-size-xs)',
    sm: 'var(--font-size-sm)',
    md: 'var(--font-size-md)',
    lg: 'var(--font-size-lg)',
    xl: 'var(--font-size-xl)',
  },
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
