import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 글자 굵기는 400·700·800만 쓴다(design-standard.md §3, 2026-11-22 사용자 결정: 지금 보이는 소비자 화면).
// 500·600이 남은 곳은 회차 직배송 운영에서 열리지 않는 예전 판매 방식(공동구매·날짜 선택) 화면뿐이고,
// 그 개수를 아래에 고정한다. 개수가 바뀌면 이 목록과 기준을 함께 다시 본다.
const srcDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

const LEGACY_MEDIUM_COUNTS = {
  'app/groupbuy/page.tsx': 4,
  'app/products/[id]/_components/DeliveryDatePicker.tsx': 3,
  'app/products/[id]/_components/LegacyProductActions.tsx': 1,
  'components/DeadlineSection.tsx': 2,
  // 홈의 "진행 중 공동구매" 묶음(예전 판매 방식 상품이 있을 때만 그린다)
  'components/HomeProductList.tsx': 2,
};

// 공용 버튼(600)을 소비자 래퍼 없이 바로 쓰지만 운영에서 열리지 않는 화면(예전 판매 방식, 꺼진 입점 문의).
const LEGACY_DIRECT_BUTTON_FILES = new Set([
  'app/groupbuy/page.tsx',
  'app/partner/page.tsx',
  'app/products/[id]/_components/DeliveryDatePicker.tsx',
  'app/products/[id]/_components/LegacyProductActions.tsx',
]);

const MEDIUM_WEIGHT =
  /var\(--fw-medium\)|\bfont-medium\b|\bfont-semibold\b|fontWeight: ?'?[56]00\b/g;

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const files = sourceFiles(srcDirectory).map((path) => ({
  path: relative(srcDirectory, path),
  // 주석 줄은 세지 않는다(설명에 굵기 이름을 적을 수 있다).
  source: readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n'),
}));

test('보이는 소비자 화면에는 굵기 500·600이 없다', () => {
  for (const { path, source } of files) {
    const count = source.match(MEDIUM_WEIGHT)?.length ?? 0;
    assert.equal(count, LEGACY_MEDIUM_COUNTS[path] ?? 0, path);
  }
});

test('소비자 버튼 래퍼와 입력칸 이름표는 공용 600 대신 700을 쓴다', () => {
  const read = (path) => files.find((file) => file.path === path)?.source ?? '';
  assert.equal(read('components/Button.tsx').match(/'font-bold'/g)?.length, 2);
  assert.match(read('components/LoadingButton.tsx'), /'font-bold'/);
  assert.match(read('app/login/_form.tsx'), /const FIELD_LABEL = '[^']*\bfont-bold\b/);
  assert.match(
    read('app/mypage/addresses/_client.tsx'),
    /<FieldLabel [^>]*className="[^"]*\bfont-bold\b/,
  );
  assert.match(read('app/checkout/_components/CheckoutForm.tsx'), /className=\{cn\('font-bold'/);
  assert.match(
    read('components/benchmark/PackageLabelFields.tsx'),
    /<FieldLabel [^>]*className="[^"]*\bfont-bold\b/,
  );
});

test('공용 버튼을 바로 쓰는 보이는 화면은 버튼마다 font-bold를 준다', () => {
  const directImport = /from '@greenhub\/ui\/components\/(button|loading-button)'/;
  for (const { path, source } of files) {
    if (!directImport.test(source) || LEGACY_DIRECT_BUTTON_FILES.has(path)) continue;
    if (path === 'components/Button.tsx' || path === 'components/LoadingButton.tsx') continue;
    // 이 파일이 공용 부품에서 바로 가져온 이름만 본다(소비자 래퍼 LoadingButton 등은 래퍼가 700을 준다).
    const uiNames = [
      ...source.matchAll(
        /import \{([^}]*)\} from '@greenhub\/ui\/components\/(?:button|loading-button)'/g,
      ),
    ].flatMap((match) =>
      match[1].split(',').map((name) =>
        name
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      ),
    );
    const opening = new RegExp(`<(${uiNames.filter(Boolean).join('|')})\\b`);
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!opening.test(line)) return;
      // 여는 태그가 끝나는 줄까지 모은다(한 줄 태그이거나, 들여쓴 '>'·'/>' 줄에서 끝난다).
      const tag = [line];
      const singleLine = /[^=]>\s*$/.test(line) || /\/>\s*$/.test(line);
      for (let next = index + 1; !singleLine && next < lines.length; next += 1) {
        tag.push(lines[next]);
        if (/^\s*\/?>\s*$/.test(lines[next])) break;
      }
      assert.match(tag.join('\n'), /\bfont-bold\b/, `${path}:${index + 1}`);
    });
  }
});

// 노랑(--color-deadline-surface)은 주문 마감·"얼마 안 남음"에만 쓴다(design-standard §2, design-direction §3.1).
// 2026-11-26 검수에서 회차 밖 상품 안내·카카오 오픈 알림 상자·홈 지난 정보 안내를 연회색으로 바꿨다.
test('마감이 아닌 안내 상자는 노란 면을 쓰지 않는다', () => {
  const read = (path) => files.find((file) => file.path === path)?.source ?? '';
  for (const path of [
    'app/products/[id]/ProductDetailClient.tsx',
    'components/benchmark/KakaoChannelCta.tsx',
    'components/HomeProductList.tsx',
  ]) {
    assert.doesNotMatch(read(path), /--color-deadline-surface/, path);
  }
});
