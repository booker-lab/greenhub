FROM node:20-alpine

WORKDIR /app

# pnpm 설치
RUN npm install -g pnpm@10.32.1

# 모노레포 루트 파일 복사
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# 공유 패키지 복사
COPY packages/ ./packages/

# API 앱 복사
COPY apps/api/ ./apps/api/

# 의존성 설치
RUN pnpm install --frozen-lockfile

# 빌드 (shared dist는 git에 포함되어 있으므로 api만 빌드)
RUN pnpm --filter api build

EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
