/**
 * 요청 본문(DTO)에서 온 값을 Firestore에 쓸 수 있는 모양으로 바꾼다.
 *
 * tsconfig target ES2023에서는 DTO 클래스의 선택 필드가 보내지 않아도 `undefined` 값의 자체 속성으로 남는다.
 * Firestore는 `undefined` 값을 받지 않으므로(set/update 모두 예외) 중첩 객체·배열 안까지 `undefined` 키를 뺀다.
 * `null`은 '지우기' 의미로 쓰이므로 그대로 둔다. DTO 인스턴스는 일반 객체로 바꾼다.
 *
 * JSON 본문에서 온 값(문자열·숫자·불리언·null·배열·객체)에만 쓴다. Timestamp·Date 같은 값은 이 함수를 거친 뒤에 붙인다.
 */
export function toFirestoreData<T extends object>(value: T): Partial<T> {
  return stripUndefined(value) as Partial<T>;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) result[key] = stripUndefined(field);
  }
  return result;
}
