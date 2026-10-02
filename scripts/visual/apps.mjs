// 화면 확인 하네스 공통 설정 — 실행기(start.mjs)와 자동 캡처(shots.mjs)가 함께 쓴다.
export const API_PORT = 4010;

// dev:local(3000~3003)과 겹치지 않는 포트를 쓴다.
export const APPS = {
  seller: { dir: 'apps/seller', port: 3102 },
};
