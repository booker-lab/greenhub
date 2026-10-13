// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // any를 허용하는 정책(no-explicit-any off)과 맞춰 any 전파 지점은 타입 부채 경고로만 남긴다.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      // 타입 없는 Firestore 필드를 String()으로 방어 변환하는 지점이다. 고치면 출력이 바뀌므로 경고로 추적한다.
      '@typescript-eslint/no-base-to-string': 'warn',
      // await 없는 async는 인터페이스 구현이 reject로 실패를 알리게 하려는 것이다. 지우면 동기 throw로 바뀐다.
      '@typescript-eslint/require-await': 'warn',
      // `_` 접두 이름은 의도적으로 쓰지 않는 값(구조분해로 필드 걸러내기, 시그니처 맞추기)이다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      // expect(mock.method)는 메서드를 호출하지 않고 참조만 넘기므로 해당하지 않는다.
      '@typescript-eslint/unbound-method': 'off',
      // 테스트는 jest.mock 뒤 모듈 로드 시점을 맞추려고 require()를 지연 호출한다.
      '@typescript-eslint/no-require-imports': 'off',
      // mock·fake 구현은 실제 Promise 계약을 흉내 내려고 await 없이 async를 쓴다.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
