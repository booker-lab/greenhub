/**
 * 운영 API 호스트의 정본. 배포 도구가 쓰는 주소이자, E2E·점검 도구가 운영 API를 잘못 건드리지 않게
 * 막는 차단 목록의 기준이다. Cloud Run 이전(docs/specs/ops/api-hosting-cloud-run-plan.md) 동안에는
 * Railway와 Cloud Run 주소가 모두 운영 호스트다.
 */

/** 지금 운영 API(Railway 기본 주소). */
export const RAILWAY_PRODUCTION_API_HOST = 'api-production-13e7.up.railway.app';

/** 운영 Cloud Run 서비스. 프로젝트 번호는 `gcloud projects describe green-e4fe3`로 확인한 값이다. */
export const CLOUD_RUN_PRODUCTION = Object.freeze({
  project: 'green-e4fe3',
  projectNumber: '988412563635',
  region: 'asia-northeast3',
  service: 'greenhub-api',
  imageRepository: 'asia-northeast3-docker.pkg.dev/green-e4fe3/greenhub/api',
});

/** Cloud Run 결정적 주소(`<서비스>-<프로젝트 번호>.<리전>.run.app`). */
export const CLOUD_RUN_PRODUCTION_API_HOST = `${CLOUD_RUN_PRODUCTION.service}-${CLOUD_RUN_PRODUCTION.projectNumber}.${CLOUD_RUN_PRODUCTION.region}.run.app`;

/** 전환 때 부하분산기로 붙이는 고정 주소(2026-10-23 사용자 확정). */
export const PRODUCTION_API_CUSTOM_HOST = 'api.greenlove.co.kr';

export const PRODUCTION_API_HOSTS = Object.freeze([
  RAILWAY_PRODUCTION_API_HOST,
  CLOUD_RUN_PRODUCTION_API_HOST,
  PRODUCTION_API_CUSTOM_HOST,
]);

// Cloud Run은 결정적 주소 말고도 `<서비스>-<해시>-du.a.run.app`(du=asia-northeast3) 주소를 함께 열고,
// 태그 배포는 두 주소 앞에 `<태그>---`를 붙인다. 해시에는 하이픈이 없으므로 `greenhub-api-staging-…` 같은
// 다른 서비스 이름은 걸리지 않는다.
const CLOUD_RUN_HASH_HOST = /^(?:[a-z0-9-]+---)?greenhub-api-[a-z0-9]+-du\.a\.run\.app$/;

/** 운영 Cloud Run 서비스의 주소(결정적·해시·태그 주소)인지. */
export function isCloudRunProductionApiHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host) return false;
  if (host === CLOUD_RUN_PRODUCTION_API_HOST) return true;
  if (host.endsWith(`---${CLOUD_RUN_PRODUCTION_API_HOST}`)) return true;
  return CLOUD_RUN_HASH_HOST.test(host);
}

/** 운영 API 호스트(Railway·Cloud Run·고정 주소)인지. 웹 앱 운영 도메인 판정은 각 도구가 따로 한다. */
export function isProductionApiHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return PRODUCTION_API_HOSTS.includes(host) || isCloudRunProductionApiHost(host);
}
