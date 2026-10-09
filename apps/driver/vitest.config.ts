import { defineConfig } from 'vitest/config';

// node:test로 작성된 *.test.mjs는 `test:node`가 실행한다. vitest는 TS 테스트만 맡는다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
