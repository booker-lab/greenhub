import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

const logoMatch = rules.match(/match\s+\/logos\/\{allPaths=\*\*\}\s*\{(?<body>[\s\S]*?)\n\s*\}/);

if (!logoMatch?.groups?.body) {
  throw new Error('storage.rules에 logos/{allPaths=**} 규칙이 없습니다.');
}

const body = logoMatch.groups.body;

const checks = [
  {
    ok: /allow\s+read\s*:\s*if\s+true\s*;/.test(body),
    message: 'logos 경로는 공개 읽기를 허용해야 합니다.',
  },
  {
    ok: /allow\s+write\s*:\s*if\s+request\.auth\s*!=\s*null\s*;/.test(body),
    message: 'logos 경로는 인증 사용자 쓰기만 허용해야 합니다.',
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  throw new Error(failed.map((check) => check.message).join('\n'));
}

console.log('로고 Storage Rules 정적 검증 통과');
