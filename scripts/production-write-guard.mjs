import { PRODUCTION_FIREBASE_PROJECT } from './check-round-direct-e2e-readiness.mjs';

// 테스트·시각 확인용 시드/초기화 스크립트가 운영 Firebase에 실수로 쓰지 않게 막는다.
// 서비스 계정의 project_id가 운영 프로젝트면, 정확한 확인 인자를 함께 준 경우에만 진행한다.
export const PRODUCTION_WRITE_FLAG = `--allow-production=${PRODUCTION_FIREBASE_PROJECT}`;

export function assertProductionWriteAllowed(serviceAccount, { script, argv = process.argv } = {}) {
  const projectId = serviceAccount?.project_id ?? serviceAccount?.projectId ?? null;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error(`${script}: 서비스 계정에서 Firebase 프로젝트를 확인할 수 없어 중단합니다.`);
  }
  if (projectId !== PRODUCTION_FIREBASE_PROJECT) return projectId;
  if (argv.includes(PRODUCTION_WRITE_FLAG)) {
    console.warn(`⚠️  ${script}: 운영 Firebase(${projectId})에 씁니다 (${PRODUCTION_WRITE_FLAG}).`);
    return projectId;
  }
  throw new Error(
    `${script}: 운영 Firebase(${projectId})에 쓰는 스크립트입니다. ` +
      `정말 운영에 실행하려면 ${PRODUCTION_WRITE_FLAG} 를 붙이세요.`,
  );
}
