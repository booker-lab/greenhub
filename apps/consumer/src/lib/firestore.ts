// Firestore REST API 파싱 유틸리티
// PWA Service Worker 충돌로 Firebase SDK 대신 REST API를 직접 사용. (CRITICAL_LOGIC.md [2026-03-27])

export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } }

export function parseFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue
  if ('integerValue' in val) return Number(val.integerValue)
  if ('doubleValue' in val) return val.doubleValue
  if ('booleanValue' in val) return val.booleanValue
  if ('nullValue' in val) return null
  if ('timestampValue' in val) return val.timestampValue
  if ('mapValue' in val) {
    const fields = val.mapValue.fields ?? {}
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, parseFirestoreValue(v)]),
    )
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values ?? []).map(parseFirestoreValue)
  }
  return null
}

export function parseFirestoreDoc<T>(doc: {
  name: string
  fields: Record<string, FirestoreValue>
}): T {
  const id = doc.name.split('/').pop()!
  const data = Object.fromEntries(
    Object.entries(doc.fields).map(([k, v]) => [k, parseFirestoreValue(v)]),
  )
  return { id, ...data } as T
}
