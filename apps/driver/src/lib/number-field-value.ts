/**
 * 숫자 칸(NumberField)의 표시 글과 입력 해석.
 *
 * - 칸에는 숫자 뒤에 단위(suffix, 예: "원")를 붙이고, 고르면 천 단위 쉼표(10,000)로 보인다.
 * - 입력은 숫자만 읽는다. 쉼표·단위를 붙여 넣어도("10,000원") 숫자로 읽는다.
 * - 지우기 키가 숫자가 아닌 글자(쉼표·단위)만 지우면 숫자가 그대로라 칸이 되돌아가 아무 일도 안 일어난 것처럼
 *   보인다. 이때는 지운 자리 바로 앞 숫자를 대신 지운다(4차 배치 검토).
 */

export function formatNumberFieldDisplay(
  value: number | string,
  { suffix = '', thousandSeparator = false }: { suffix?: string; thousandSeparator?: boolean } = {},
): string {
  if (value === '') return '';
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9]/g, ''));
  const shown =
    thousandSeparator && Number.isFinite(numeric) ? numeric.toLocaleString('ko-KR') : value;
  return `${shown}${suffix}`;
}

/**
 * 칸의 새 글(`next`)을 이전 표시 글(`previous`)과 견주어 다음 값을 돌려준다. 빈 칸이면 ''.
 */
export function readNumberFieldInput(previous: string, next: string, min = 0): number | string {
  let digits = next.replace(/[^0-9]/g, '');
  if (digits === previous.replace(/[^0-9]/g, '') && next.length === previous.length - 1) {
    // 한 글자가 지워졌는데 숫자가 그대로다 → 지운 글자는 쉼표·단위다. 그 앞 숫자를 지운다.
    let removedAt = 0;
    while (removedAt < next.length && next[removedAt] === previous[removedAt]) removedAt += 1;
    for (let index = removedAt - 1; index >= 0; index -= 1) {
      if (/[0-9]/.test(previous[index] ?? '')) {
        digits = (previous.slice(0, index) + previous.slice(index + 1)).replace(/[^0-9]/g, '');
        break;
      }
    }
  }
  return digits === '' ? '' : Math.max(min, Number(digits));
}
