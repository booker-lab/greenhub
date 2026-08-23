# Deployment Safety Guards — 2026-08-23

> 상태: in_progress

## 확인된 위험

- GitHub `main`은 현재 branch protection/ruleset이 비활성 상태다.
- Vercel consumer/seller/driver 3개 프로젝트는 GitHub `main` push에 대해 production-target deployment를 생성한다.
- consumer는 docs-only `main` commit도 실제 production deployment `READY`까지 진행했다.
- `.github/workflows/sync-preview.yml`은 모든 `main` push에서 `preview`를 자동 동기화한 뒤 3앱 Preview 배포 대기와 일반 E2E dispatch까지 수행한다.

## 목표 상태

1. `main` merge 자체가 production 배포를 의미하지 않는다.
2. production은 승인된 release SHA를 명시적으로 배포하는 경로만 사용한다.
3. docs-only 변경은 preview sync/E2E를 불필요하게 실행하지 않는다.
4. `main` 직접 push를 차단하고 PR 기반 변경만 허용한다.

## 적용 순서

1. repository-side Vercel Git deployment guard 추가
2. docs-only `main` push의 preview sync 제외
3. GitHub `main` branch protection/ruleset 적용
4. Vercel project Git integration에서 `main` auto production deploy 비활성화 확인
5. exact-SHA production deploy 승인 경로 확정

## 승인

사용자 `배포 안전장치 변경 승인` 수신 후 수행한다.
