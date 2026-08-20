import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const layoutSource = readFileSync(join(testDirectory, 'layout.tsx'), 'utf8');

test('메타데이터 제목에 브랜드와 운영 사업자 및 업종 관계를 명시한다', () => {
  assert.match(layoutSource, /title: '그린러브 \| 디어 오키드가 운영하는 화훼 쇼핑몰'/);
});

test('메타데이터 설명에 그린러브와 디어 오키드의 운영 관계를 명시한다', () => {
  assert.match(
    layoutSource,
    /description: '그린러브는 사업자 디어 오키드가 운영하는 화훼 쇼핑몰입니다\.'/,
  );
});
