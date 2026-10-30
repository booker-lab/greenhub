export default {
  plugins: {
    // Tailwind가 @import(Mantine CSS 포함)를 먼저 펼치고 layer로 감싼다(ui-stack-migration-plan.md P2a·P3).
    '@tailwindcss/postcss': {},
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
