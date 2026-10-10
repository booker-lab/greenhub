# syntax=docker/dockerfile:1

# Node 22 LTS. 태그와 다이제스트를 함께 고정한다(다이제스트가 실제 이미지를 결정).
# 갱신: docker buildx imagetools inspect node:22-alpine 으로 새 다이제스트를 확인해 태그와 함께 바꾼다.
ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ---- build: 전체 의존성으로 api 빌드 후 운영 의존성만 담은 배포 디렉터리 생성 ----
FROM ${NODE_IMAGE} AS build

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# pnpm 버전은 루트 package.json의 packageManager를 따른다.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

# 루트 postinstall이 참조하는 스크립트만 복사한다(scripts 워크스페이스 전체는 넣지 않는다).
COPY scripts/copy-fonts.cjs ./scripts/copy-fonts.cjs

# 공유 패키지(dist는 git에 포함)와 API 앱
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

RUN pnpm install --frozen-lockfile --filter api...

RUN pnpm --filter api build

# 운영 의존성만 담은 api 패키지를 /out에 만든다.
RUN pnpm --filter api deploy --prod --legacy /out \
  && rm -rf /out/dist/scripts

# ---- runtime: 빌드 산출물과 운영 의존성만 포함, 비루트 실행 ----
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production

WORKDIR /app

# 기존 시작 명령(node apps/api/dist/main)과 같은 경로를 유지한다.
# 파일은 root 소유로 두어 실행 사용자(node)가 수정할 수 없게 한다.
COPY --from=build /out/package.json ./apps/api/package.json
COPY --from=build /out/node_modules ./apps/api/node_modules
COPY --from=build /out/dist ./apps/api/dist

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
