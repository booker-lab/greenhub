const { copyFileSync, mkdirSync, existsSync, renameSync, rmSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const src = join(root, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')

if (!existsSync(src)) {
  console.warn('[copy-fonts] pretendard 패키지를 찾을 수 없습니다. pnpm install 후 재시도하세요.')
  process.exit(0)
}

// 앱 prebuild가 병렬로 실행되면 같은 대상 파일을 동시에 쓴다. 프로세스별 임시 파일에 복사한 뒤
// rename으로 교체해, 다른 프로세스가 먼저 만든 파일이 있어도 EEXIST 없이 덮어쓴다.
const apps = ['consumer', 'seller', 'driver']
for (const app of apps) {
  const dest = join(root, `apps/${app}/public/fonts`)
  mkdirSync(dest, { recursive: true })
  const target = join(dest, 'PretendardVariable.woff2')
  const tmp = `${target}.${process.pid}.tmp`
  try {
    copyFileSync(src, tmp)
    renameSync(tmp, target)
  } finally {
    rmSync(tmp, { force: true })
  }
  console.log(`[copy-fonts] ✅ apps/${app}/public/fonts/PretendardVariable.woff2`)
}
