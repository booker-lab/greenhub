// 화면 안 동작(steps) 실행기 — shots.mjs(촬영)와 focus-trap.mjs(창 초점 순회 검사)가 함께 쓴다.
// fixture 화면의 steps 형식은 README "자동 캡처와 확인판"을 따른다.

// 대상이 화면에 나올 때까지 잠시 기다린다. 화면 열기 대기(networkidle·고정 대기)가 끝나도 next dev가 그 화면을
// 처음 컴파일하거나 데이터가 늦으면 입력칸이 아직 없을 수 있다(focus-trap 전체 실행에서 admin-stores-search가 간헐로
// "입력칸 없음"). 판정은 그대로다: 시간 안에 나오지 않으면 예전처럼 "없음"으로 멈춘다.
const APPEAR_TIMEOUT_MS = 5_000;
async function appears(target) {
  return target
    .waitFor({ state: 'visible', timeout: APPEAR_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
}

/**
 * steps: 찍기 전에 차례로 누르거나 적는다. 누를 글자가 없으면(기능이 꺼진 화면) 거기서 멈춘다.
 * apiBase: 가짜 API 주소. scenario 단계(화면을 연 뒤 가짜 API 상황 바꾸기)에 쓴다.
 */
export async function runSteps(page, steps, { apiBase } = {}) {
  for (const step of steps) {
    if (step.click) {
      const target = page.getByText(step.click, { exact: true }).first();
      if (!(await appears(target))) return `누를 글자 없음: ${step.click}`;
      await target.click();
    } else if (step.clickSelector) {
      // 글자가 없는 대상(값이 든 입력칸 등)은 CSS 선택자로 실제 마우스 클릭을 한다.
      const target = page.locator(step.clickSelector).first();
      if (!(await appears(target))) return `누를 대상 없음: ${step.clickSelector}`;
      await target.click();
    } else if (step.scenario) {
      // 화면을 연 뒤에 가짜 API 상황을 바꾼다(예: 다음 쓰기 요청만 오래 걸리게 해 불러오는 중 버튼을 찍는다).
      if (!apiBase) return `상황을 바꿀 가짜 API 주소 없음: ${step.scenario}`;
      const res = await fetch(`${apiBase}/__scenario?name=${encodeURIComponent(step.scenario)}`, {
        method: 'POST',
      });
      if (!res.ok) return `없는 상황: ${step.scenario}`;
      continue;
    } else if (step.waitPath) {
      // 앱이 스스로 주소를 바꾸는 동작(결제 완료 뒤 router.replace 등)을 기다린다. next dev는 처음 여는 화면을
      // 그때 컴파일하므로 넉넉히 기다린다. 끝내 바뀌지 않으면 도착 주소 판정이 실패로 잡는다.
      await page
        .waitForURL((url) => url.pathname === step.waitPath, { timeout: 60_000 })
        .catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    } else if (step.press) {
      // 버튼은 접근성 이름으로 누른다(글자가 기호뿐인 버튼·같은 글자가 여러 곳인 버튼). nth로 몇 번째인지 고른다.
      const target = page.getByRole('button', { name: step.press, exact: true }).nth(step.nth ?? 0);
      if (!(await appears(target))) return `누를 버튼 없음: ${step.press}`;
      await target.click();
    } else if (step.check) {
      // 체크박스는 접근성 이름으로 찾아 켠다(라벨 글자를 누르는 것과 같다).
      const target = page.getByRole('checkbox', { name: step.check, exact: true }).first();
      if (!(await appears(target))) return `체크박스 없음: ${step.check}`;
      await target.check();
    } else if (typeof step.fill === 'string') {
      await page.getByRole('textbox').first().fill(step.fill);
    } else if (step.fill) {
      const { label, value, nth = 0 } = step.fill;
      const target = page.getByLabel(label).nth(nth);
      if (!(await appears(target))) return `입력칸 없음: ${label}`;
      await target.fill(value);
    }
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  return null;
}
