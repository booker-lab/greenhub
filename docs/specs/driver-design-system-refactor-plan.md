# 드라이버앱 디자인 시스템 리팩토링 플랜

> 작성: 2026-04-25  
> 대상: `apps/driver/src/` UI 레이어 (11개 파일, 약 1,218줄)  
> 원칙: **로직 불변** — 훅·API·Firebase·상태관리 코드 일절 수정 금지. UI 레이어만 변경.  
> 선행 완료: `packages/ui/src/style.css` 시맨틱 토큰 — consumer/seller 작업 시 확정됨

---

## 예외 규칙 (변경 금지)

| 항목 | 이유 |
|------|------|
| `#FEE500`, `#191919` (카카오 버튼) | 브랜드 컬러 — login/page.tsx, profile/page.tsx |
| `color=` prop on Badge/Button | Mantine 컴포넌트 테마 연동 |
| `photo/page.tsx` gradient 2건 | 카메라 캡처 UI 기능 필수 |
| `photo/page.tsx` `backgroundColor: "#000"` | 카메라 뷰파인더 배경 |
| `viewport.themeColor: "#2D6A4F"` | meta viewport — 브라우저 UI |

---

## var() 매핑표

| 기존 | 대체 토큰 |
|------|---------|
| `var(--green-primary)` | `var(--color-primary)` |
| `var(--green-pale)` | `var(--color-primary-surface)` |
| `var(--green-dark)` | `var(--color-primary-dark)` |
| `var(--mantine-color-white)` | `var(--color-bg)` |
| `var(--mantine-color-gray-1)` | `var(--color-surface-muted)` |
| `var(--mantine-color-gray-2/3)` | `var(--color-border)` → `var(--border)` |
| `var(--mantine-color-gray-5)` | `var(--color-text-disabled)` |
| `var(--mantine-color-gray-6/7)` | `var(--color-text-secondary)` |
| `"white"` / `#ffffff` / `#FFFFFF` | `var(--color-bg)` |
| `#9CA3AF` | `var(--color-text-disabled)` |
| `#000` / `#000000` | `var(--color-text)` (카메라 배경은 예외) |
| `#ef4444` | `var(--color-danger)` |
| `c="dimmed"` | `style={{ color: 'var(--color-text-disabled)' }}` |
| `c="brand.6"` | `style={{ color: 'var(--color-primary)' }}` |
| `c="blue"` (상태표시) | `style={{ color: 'var(--color-primary)' }}` |
| `c="red.4"` | `style={{ color: 'var(--color-danger)' }}` |
| `c="white"` | `style={{ color: 'var(--color-bg)' }}` |
| `c="dark"` | `style={{ color: 'var(--color-text)' }}` |
| `c="gray.4"` | `style={{ color: 'var(--color-text-disabled)' }}` |
| `fw={500}` / `fw={600}` | `style={{ fontWeight: 'var(--fw-medium)' }}` ← 600은 bold로 올림 |
| `fw={700}` | `style={{ fontWeight: 'var(--fw-bold)' }}` |
| `fz={20}` / `fz="xl"` | `style={{ fontSize: 'var(--font-size-xl)' }}` |
| `fz={11}` | `style={{ fontSize: 'var(--font-size-sm)' }}` (최소 15px) |
| `fontSize: 14` (inline) | `fontSize: 'var(--font-size-sm)'` |
| `fontSize: 11` (inline) | `fontSize: 'var(--font-size-sm)'` |
| `<Text size="xs/sm">` | size prop 제거 + `style={{ fontSize: 'var(--font-size-sm)' }}` |
| `boxShadow:` in BottomNav | 제거 + `borderTop: 'var(--border)'` 추가 |
| `boxShadow:` in 촬영 버튼 | 제거 (shadow 금지) |
| `Paper shadow="sm"` | shadow 제거 + `style={{ border: 'var(--border)' }}` |

---

## 1단계 — 공통 기반

### ✅ DT1 — `apps/driver/src/app/layout.tsx` (52줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 2 | `import { Geist } from "next/font/google"` | **제거** (Pretendard는 style.css CDN에서 로드) |
| 8-11 | `const geistSans = Geist({...})` 블록 | **제거** |
| 38 | `className={geistSans.variable}` | `className=""` 제거 또는 속성 삭제 |
| 44 | `backgroundColor: '#ffffff'` | `backgroundColor: 'var(--color-bg)'` |

로직 불변 확인: 없음 (순수 레이아웃)

---

### ✅ DT2 — `apps/driver/src/components/BottomNav.tsx` (81줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 12 | `stroke={active ? "var(--green-primary)" : "#9CA3AF"}` | `stroke={active ? "var(--color-primary)" : "var(--color-text-disabled)"}` |
| 21 | 동일 | 동일 |
| 30 | 동일 | 동일 |
| 51 | `backgroundColor: "var(--mantine-color-white)"` | `backgroundColor: 'var(--color-bg)'` |
| 52 | `boxShadow: "0 -2px 12px rgba(0,0,0,0.08)"` | **제거** |
| 52 위 | (없음) | `borderTop: 'var(--border)',` 추가 |
| 71 | `<Text size="xs" fw={active ? 600 : 500} c={active ? "brand.6" : "gray.4"}>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: active ? 'var(--fw-bold)' : 'var(--fw-medium)', color: active ? 'var(--color-primary)' : 'var(--color-text-disabled)' }}>` |

로직 불변 확인: `active`, `pathname.startsWith(tab.href)` 변경 금지

---

### ✅ DT3 — `apps/driver/src/components/OrderCard.tsx` (76줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 55 | `<Text size="xs" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 61 | `<Text fw={600} size="sm">` | `<Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>` |
| 64 | `<Text size="sm" c="dimmed" truncate="end">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} truncate="end">` |
| 68 | `<Text size="xs" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 19-21 | `METHOD_BADGE` 의 `color: "green/blue/gray"` | **유지** (Badge color prop 예외) |

로직 불변 확인: `formatTime`, `METHOD_BADGE` 로직 변경 금지

---

## 2단계 — 인증

### ✅ DT4 — `apps/driver/src/app/login/page.tsx` (85줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 18 | `backgroundColor: "#FFFFFF"` | `backgroundColor: 'var(--color-bg)'` |
| 23 | `<Paper radius="lg" shadow="sm" p="xl">` | `<Paper radius="lg" p="xl" style={{ border: 'var(--border)' }}>` |
| 31 | `backgroundColor: "var(--green-primary)"` | `backgroundColor: 'var(--color-primary)'` |
| 37 | `stroke="white"` | `stroke="var(--color-bg)"` |
| 44 | `<Title order={2} fz="xl">` | `<Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>` |
| 45 | `<Text size="sm" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 51 | `<Text size="sm" fw={600} mb={4}>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }} mb={4}>` |
| 52 | `<Text size="xs">` | `<Text style={{ fontSize: 'var(--font-size-sm)' }}>` |
| 71 | `#FEE500`, `#191919` | **유지** (카카오 예외) |

로직 불변 확인: `signIn("kakao", ...)` server action 변경 금지

---

### ✅ DT5 — `apps/driver/src/app/providers.tsx` (30줄)

**변경 없음** — UI 위반 항목 없음. `TokenErrorGuard` 로직 불변 확인 후 통과.

---

## 3단계 — 배달 현황 (board)

### ✅ DT6 — `apps/driver/src/app/board/page.tsx` (19줄) + `board/_client.tsx` (150줄)

**board/page.tsx 변경:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 14 | `<Loader color="brand" />` | **유지** (Mantine color prop 예외) |

**board/_client.tsx 변경:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 79 | `backgroundColor: "var(--mantine-color-white)"` | `backgroundColor: 'var(--color-bg)'` |
| 80 | `borderBottom: "1px solid var(--mantine-color-gray-2)"` | `borderBottom: 'var(--border)'` |
| 86 | `<Text size="xs" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 102 | `fontSize: 14` | `fontSize: 'var(--font-size-sm)'` |
| 103 | `fontWeight: 600` | `fontWeight: 'var(--fw-bold)'` |
| 104 | `"var(--green-primary)"` (border) | `"var(--color-primary)"` |
| 105 | `"var(--green-primary)"` (color) | `"var(--color-primary)"` |
| 105 | `"var(--mantine-color-gray-5)"` | `"var(--color-text-disabled)"` |
| 131 | `<Text size="sm" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 135 | `<Anchor size="xs" c="brand.6"` | `<Anchor style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}` |

로직 불변 확인: `firebaseReady`, `onSnapshot`, `tab` 상태 변경 금지

---

### ✅ DT7 — `apps/driver/src/app/board/[orderId]/page.tsx` (220줄)

**본문 + InfoRow + ContactRow:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 105 | `backgroundColor: "var(--mantine-color-white)"` | `backgroundColor: 'var(--color-bg)'` |
| 106 | `borderBottom: "1px solid var(--mantine-color-gray-2)"` | `borderBottom: 'var(--border)'` |
| 113 | `color: "var(--mantine-color-gray-6)"` | `color: 'var(--color-text-secondary)'` |
| 122 | `<Text size="sm" fw={600} c="blue">배송 중</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>배송 중</Text>` |
| 132 | `<Text size="sm" fw={600} c="dimmed">주문 정보</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text-disabled)' }}>주문 정보</Text>` |
| 150 | `<Text size="sm" fw={600} c="dimmed">연락처</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text-disabled)' }}>연락처</Text>` |
| 184 | `<Text size="sm" c="dimmed">` (InfoRow label) | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 185 | `<Text size="sm" fw={500}` (InfoRow value) | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}` |
| 194 | `<Text size="xs" c="dimmed">` (ContactRow label) | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 195 | `<Text size="sm" fw={500}>` (ContactRow phone) | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>` |
| 204 | `backgroundColor: "var(--green-pale)"` | `backgroundColor: 'var(--color-primary-surface)'` |
| 205 | `color: "var(--green-dark)"` | `color: 'var(--color-primary-dark)'` |
| 207 | `fontWeight: 600` | `fontWeight: 'var(--fw-bold)'` |
| 208 | `fontSize: 14` | `fontSize: 'var(--font-size-sm)'` |

로직 불변 확인: `updateStatus`, `apiFetch`, `onSnapshot`, `firebaseReady` 변경 금지

---

### ✅ DT8 — `apps/driver/src/app/board/[orderId]/photo/page.tsx` (209줄)

**카메라 UI — 예외 먼저 확인 후 위반만 수정:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 97 | `backgroundColor: "#000"` | **유지** (카메라 뷰파인더 예외) |
| 103 | `linear-gradient(...) 헤더` | **유지** (카메라 오버레이 예외) |
| 107 | `color: "white"` (뒤로가기 버튼) | `color: 'var(--color-bg)'` |
| 113 | `<Text c="white" fw={600}>` | `<Text style={{ color: 'var(--color-bg)', fontWeight: 'var(--fw-bold)' }}>` |
| 123 | `<Text c="white" size="sm">` | `<Text style={{ color: 'var(--color-bg)', fontSize: 'var(--font-size-sm)' }}>` |
| 124 | `<Button color="white" c="dark" radius="md">` | `color="white"` **유지** + `c="dark"` → `style={{ color: 'var(--color-text)' }}` |
| 127 | `c="red.4" size="sm"` | `style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}` |
| 145 | `backgroundColor: "white"` (셔터버튼) | `backgroundColor: 'var(--color-bg)'` |
| 145 | `border: "4px solid var(--green-primary)"` | `border: '4px solid var(--color-primary)'` |
| 146 | `boxShadow: "0 4px 12px rgba(0,0,0,0.3)"` | **제거** |
| 171 | `linear-gradient(...) 하단` | **유지** (카메라 오버레이 예외) |
| 201 | `backgroundColor: "#ef4444"` | `backgroundColor: 'var(--color-danger)'` |
| 201 | `color: "white"` (에러텍스트) | `color: 'var(--color-bg)'` |

로직 불변 확인: `startCamera`, `capture`, `upload`, Firebase Storage, `apiFetch` 변경 금지

---

## 4단계 — 지도 · 프로필

### ✅ DT9 — `apps/driver/src/app/map/page.tsx` (203줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 93 | `backgroundColor: "var(--mantine-color-white)"` | `backgroundColor: 'var(--color-bg)'` |
| 94 | `borderBottom: "1px solid var(--mantine-color-gray-2)"` | `borderBottom: 'var(--border)'` |
| 99 | `<Text size="xs" c="dimmed" mt={2}>` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mt={2}>` |
| 109 | `backgroundColor: "var(--mantine-color-gray-1)"` | `backgroundColor: 'var(--color-surface-muted)'` |
| 110 | `border: "1px solid var(--mantine-color-gray-3)"` | `border: 'var(--border)'` |
| 117 | `stroke="var(--mantine-color-gray-5)"` (SVG) | `stroke="var(--color-text-disabled)"` |
| 120 | `<Text size="xs" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 121 | `<Text size="xs" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 129 | `<Text size="sm" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 145 | `backgroundColor: "var(--mantine-color-white)"` | `backgroundColor: 'var(--color-bg)'` |
| 147 | `border: "1px solid var(--mantine-color-gray-2)"` | `border: 'var(--border)'` |
| 157 | `backgroundColor: "var(--green-primary)"` | `backgroundColor: 'var(--color-primary)'` |
| 158 | `color: "white"` | `color: 'var(--color-bg)'` |
| 159 | `fontSize: 11` | `fontSize: 'var(--font-size-sm)'` (11px < 최소 15px) |
| 160 | `fontWeight: 700` | `fontWeight: 'var(--fw-bold)'` |
| 169 | `<Text size="sm" fw={500} truncate="end">` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} truncate="end">` |
| 170 | `<Text size="xs" c="dimmed" truncate="end">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} truncate="end">` |

로직 불변 확인: `nearestNeighbor`, `buildKakaoNaviUrl`, `onSnapshot`, `firebaseReady` 변경 금지

---

### ✅ DT10 — `apps/driver/src/app/profile/page.tsx` (93줄)

**변경 목록:**
| 줄 | 현재 | 변경 후 |
|---|------|--------|
| 37 | `backgroundColor: "var(--green-pale)"` | `backgroundColor: 'var(--color-primary-surface)'` |
| 43 | `c="brand.6" fw={700} fz={20}` | `style={{ color: 'var(--color-primary)', fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-xl)' }}` |
| 49 | `<Text fw={700}>` | `<Text style={{ fontWeight: 'var(--fw-bold)' }}>` |
| 50 | `<Text size="sm" c="dimmed">` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>` |
| 58 | `<Text size="sm" c="dimmed">연결된 계정</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>연결된 계정</Text>` |
| 60 | `backgroundColor: "#FEE500"` (카카오 아이콘) | **유지** (카카오 예외) |
| 61 | `<Text size="sm" fw={500}>카카오</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>카카오</Text>` |
| 65 | `<Text size="sm" c="dimmed">앱 버전</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>앱 버전</Text>` |
| 66 | `<Text size="sm" c="dimmed">1.0.0</Text>` | `<Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>1.0.0</Text>` |

로직 불변 확인: `auth()`, `signOut()` server action 변경 금지

---

## 5단계 — 타입체크 + 정합성 최종 검증

### ✅ DT11 — TypeScript + 잔존 위반 검증

```bash
# TypeScript 검사
cd apps/driver && npx tsc --noEmit
# 목표: 0 errors

# 구 변수 잔존 확인
grep -rn "green-primary\|green-pale\|green-dark" apps/driver/src/
# 목표: 0건

# Mantine 변수 잔존 확인
grep -rn "mantine-color-" apps/driver/src/
# 목표: 0건

# Text size prop 잔존 확인
grep -rn '<Text[^>]*size="' apps/driver/src/
# 목표: 0건 (카메라 제외)

# hex 잔존 확인 (카카오 예외 제외)
grep -rn '"#[0-9A-Fa-f]' apps/driver/src/ | grep -v "FEE500\|191919\|2D6A4F\|000\b"
# 목표: 0건
```

---

## 진행 규칙

1. **로직 불변** — 각 DT 테이블의 "로직 불변 확인" 항목 준수 필수
2. 각 DT 완료 즉시 체크박스 `✅` 표시
3. DT1 완료 후 IDE 진단 확인 (Geist 제거로 인한 에러 없는지)
4. DT8(photo) 완료 후 카메라 예외 항목 3개 재확인
5. DT11 grep 결과 0건 확인 후 세션 종료
