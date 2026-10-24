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

test('빌드 때 켜진 기능 토글 키를 greenhub-features meta로 내보낸다(E2E 판정용)', () => {
  assert.match(layoutSource, /import \{ enabledFeatureKeys \} from '@\/lib\/features';/);
  assert.match(
    layoutSource,
    /<meta name="greenhub-features" content=\{enabledFeatureKeys\(\)\.join\(','\)\} \/>/,
  );
});

test('메타데이터 설명에 그린러브와 디어 오키드의 운영 관계를 명시한다', () => {
  assert.match(
    layoutSource,
    /description: '그린러브는 사업자 디어 오키드가 운영하는 화훼 쇼핑몰입니다\.'/,
  );
});

test('네이버 서치어드바이저 소유 확인 meta를 내보낸다', () => {
  assert.match(
    layoutSource,
    /'naver-site-verification': 'a69f8be2ede55c9efa26e8e75d077f9e9ea8ecbe'/,
  );
});
