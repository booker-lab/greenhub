// 화면 확인 하네스 공통 설정 — 실행기(start.mjs)와 자동 캡처(shots.mjs)가 함께 쓴다.
// dev:local(3000~3003)·로컬 E2E(127.0.0.x:3101~3103)와 겹치지 않는 3200번대를 쓰고, 두 앱을 동시에 띄울 수 있게 가짜 API 포트도 앱마다 나눈다.
//
// credentials: 로그인 화면에서 이메일·비밀번호 로그인을 켜는 방식
//   'local-runtime' — GREENHUB_LOCAL_RUNTIME=true면 헤더 게이트 없이 허용(셀러 auth.ts)
//   'e2e-header'    — E2E_TEST=true + x-e2e-test-token 헤더가 E2E_TEST_SECRET과 같아야 허용(소비자 auth.ts)
export const APPS = {
  seller: { dir: 'apps/seller', port: 3202, apiPort: 4202, credentials: 'local-runtime' },
  consumer: { dir: 'apps/consumer', port: 3201, apiPort: 4201, credentials: 'e2e-header' },
};

/** start.mjs가 기동 정보를 남기고 shots.mjs가 읽는 파일(실행마다 새로 만드는 하네스 전용 비밀값 포함). */
export const RUNTIME_FILE = 'runtime.json';
