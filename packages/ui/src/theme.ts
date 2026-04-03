import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#F0FFF4', // 0 - green-bg
  '#D8F3DC', // 1 - green-pale
  '#95D5B2', // 2 - green-light
  '#74C69D', // 3
  '#52B788', // 4
  '#40916C', // 5
  '#2D6A4F', // 6 - green-primary  ← 기본
  '#1B4332', // 7 - green-dark
  '#163B2D', // 8
  '#0D2B1E', // 9
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'var(--font-geist-sans), -apple-system, sans-serif',
  defaultRadius: 'md',
  focusRing: 'auto',
  components: {
    Button: {
      defaultProps: { radius: 'xl' },
    },
    TextInput: {
      defaultProps: { radius: 'md' },
    },
    Card: {
      defaultProps: { radius: 'xl', withBorder: true },
    },
  },
});
