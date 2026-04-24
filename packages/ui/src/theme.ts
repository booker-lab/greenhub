import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#F2FBF6', // 0
  '#E0F5E9', // 1
  '#A8DFC0', // 2
  '#74C69D', // 3
  '#52B788', // 4
  '#40916C', // 5
  '#2D6A4F', // 6 - primary
  '#1B4332', // 7
  '#163B2D', // 8
  '#0D2B1E', // 9
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  defaultRadius: 16,
  focusRing: 'auto',
  components: {
    Button: {
      defaultProps: { radius: 16 },
    },
    TextInput: {
      defaultProps: { radius: 16 },
    },
    Card: {
      defaultProps: { radius: 16, shadow: undefined, withBorder: true },
    },
  },
});
