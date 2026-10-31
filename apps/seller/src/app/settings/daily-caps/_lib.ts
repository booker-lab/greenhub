import { todayKST } from '@greenhub/shared';

/**
 * 처음 보여 줄 달(KST 기준). 오늘 칸(todayKST)과 같은 기준으로 정한다.
 * 서버(Vercel·하네스는 UTC) 지역 시간의 getMonth()로 정하면 KST 매월 1일 00~09시에 서버는 전달, 브라우저는
 * 이번 달을 그려 hydration 오류가 난다.
 */
export function currentMonthKST(): { year: number; month: number } {
  const [year, month] = todayKST().split('-').map(Number);
  return { year, month: month - 1 };
}
