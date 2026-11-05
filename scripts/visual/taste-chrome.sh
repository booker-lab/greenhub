#!/usr/bin/env sh
# Taste Skill inspect.mjs는 Chromium에 --no-sandbox를 넘기지 않는다(scripts/lib/cdp.mjs의 실행 인자).
# 컨테이너(root)에서는 샌드박스 없이만 뜨므로 CHROME_PATH로 이 래퍼를 준다.
#   CHROME_PATH=scripts/visual/taste-chrome.sh node scripts/visual/taste-skill/scripts/inspect.mjs <url> --app
# 브라우저 경로는 GREENHUB_TASTE_CHROMIUM으로 바꾼다(기본: 컨테이너에 설치된 Playwright Chromium).
exec "${GREENHUB_TASTE_CHROMIUM:-/opt/pw-browsers/chromium}" --no-sandbox "$@"
