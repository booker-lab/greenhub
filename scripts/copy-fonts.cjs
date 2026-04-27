const { cpSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const src = join(root, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')

if (!existsSync(src)) {
  console.warn('[copy-fonts] pretendard 패키지를 찾을 수 없습니다. pnpm install 후 재시도하세요.')
  process.exit(0)
}

const apps = ['consumer', 'seller', 'driver']
for (const app of apps) {
  const dest = join(root, `apps/${app}/public/fonts`)
  mkdirSync(dest, { recursive: true })
  cpSync(src, join(dest, 'PretendardVariable.woff2'))
  console.log(`[copy-fonts] ✅ apps/${app}/public/fonts/PretendardVariable.woff2`)
}
