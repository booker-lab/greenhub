// 어드민 날짜 표기 — 순수 함수(design-direction.md §5 어드민 "날짜": 비교 열 `2026-11-28`, 시각 `2026-11-28 21:14`).
// 화면 컴포넌트를 끌어오지 않도록 adminList.tsx와 나눠 둔다(_lib 순수 함수가 이 파일만 읽는다).

/** 서버 시각 값(ISO 문자열·Firestore `{ _seconds }`·Date)을 Date로 읽는다. 읽을 수 없으면 null. */
export function parseAdminTime(value: unknown): Date | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string' && value.trim() !== '') date = new Date(value);
  else if (value && typeof value === 'object' && '_seconds' in value) {
    const seconds = (value as { _seconds: unknown })._seconds;
    if (typeof seconds === 'number') date = new Date(seconds * 1000);
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const KST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function kstParts(date: Date): Record<string, string> {
  return Object.fromEntries(KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
}

/** 비교하는 날짜 열 — 한국 시간 "2026-11-28". 값이 없으면 null(호출 쪽에서 회색 "–"). */
export function formatAdminDate(value: unknown): string | null {
  const date = parseAdminTime(value);
  if (!date) return null;
  const p = kstParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 날짜와 시각 — 한국 시간 "2026-11-28 21:14"(24시간, 오전·오후 없음). */
export function formatAdminDateTime(value: unknown): string | null {
  const date = parseAdminTime(value);
  if (!date) return null;
  const p = kstParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
