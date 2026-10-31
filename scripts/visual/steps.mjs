// 화면 안 동작(steps) 실행기 — shots.mjs(촬영)와 focus-trap.mjs(창 초점 순회 검사)가 함께 쓴다.
// fixture 화면의 steps 형식은 README "자동 캡처와 확인판"을 따른다.

/** steps: 찍기 전에 차례로 누르거나 적는다. 누를 글자가 없으면(기능이 꺼진 화면) 거기서 멈춘다. */
export async function runSteps(page, steps) {
  for (const step of steps) {
    if (step.click) {
      const target = page.getByText(step.click, { exact: true }).first();
      if (!(await target.isVisible().catch(() => false))) return `누를 글자 없음: ${step.click}`;
      await target.click();
    } else if (step.clickSelector) {
      // 글자가 없는 대상(값이 든 입력칸 등)은 CSS 선택자로 실제 마우스 클릭을 한다.
      const target = page.locator(step.clickSelector).first();
      if (!(await target.isVisible().catch(() => false)))
        return `누를 대상 없음: ${step.clickSelector}`;
      await target.click();
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
      if (!(await target.isVisible().catch(() => false))) return `누를 버튼 없음: ${step.press}`;
      await target.click();
    } else if (step.check) {
      // 체크박스는 접근성 이름으로 찾아 켠다(라벨 글자를 누르는 것과 같다).
      const target = page.getByRole('checkbox', { name: step.check, exact: true }).first();
      if (!(await target.isVisible().catch(() => false))) return `체크박스 없음: ${step.check}`;
      await target.check();
    } else if (typeof step.fill === 'string') {
      await page.getByRole('textbox').first().fill(step.fill);
    } else if (step.fill) {
      const { label, value, nth = 0 } = step.fill;
      const target = page.getByLabel(label).nth(nth);
      if (!(await target.isVisible().catch(() => false))) return `입력칸 없음: ${label}`;
      await target.fill(value);
    }
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  return null;
}
