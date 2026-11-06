# Taste Skill 반입본

- 원본: https://github.com/Leonxlnx/taste-skill `skills/taste-skill/`
- 버전: v2.1.5 (태그 커밋 `12af471f627f866411b4bd785b19646d3672784c`), MIT(`LICENSE`)
- 반입 결정: `docs/specs/frontend/ui-stack-migration-plan.md` §10 M4, §9 "디자인 검수"
- 바꾼 것: `evals/`를 뺐다. 그 밖의 파일은 원본 그대로다(고치지 않는다. 버전을 올릴 때는 통째로 바꾼다).
- 위치: 에이전트 스킬로 자동으로 읽히지 않도록 `.claude/skills/`가 아니라 여기에 둔다.
  `scripts/` 아래라 운영 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`)이 앱 빌드와 무관한 경로로 본다.
- 쓰임: ② 방향 적용 PR의 권고 검수만(병합 게이트 아님).
  - 앱 화면 lint: `node scripts/visual/taste-skill/scripts/lint.mjs --app <폴더>`
  - 로그인 없이 열리는 화면: `CHROME_PATH=scripts/visual/taste-chrome.sh node scripts/visual/taste-skill/scripts/inspect.mjs <url> --app`
  - 결과 폴더 `.taste-skill/`은 커밋하지 않는다(`.gitignore`).
  - `draw.mjs`는 쓰지 않는다(방향은 `docs/specs/frontend/design-direction.md`, 계획 §7 의도한 이탈).
