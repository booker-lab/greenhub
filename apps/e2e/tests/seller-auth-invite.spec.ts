import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const API = 'https://api-production-13e7.up.railway.app'
const CLEANUP_SCRIPT = resolve(__dirname, '../../../scripts/cleanup-spec-residue.mjs')

/**
 * POST /auth/register — 초대 토큰 검증 (BUG-SEC)
 *
 * seller role은 관리자 초대 토큰 없이 가입 불가.
 * consumer·driver는 토큰 없이 자유 가입 가능 (기존 동작 유지).
 *
 * 주의: API 배포 후 실행 필요.
 */
test.describe('POST /auth/register — 초대 토큰 검증', () => {
  // afterAll에서 일괄 삭제 — 잔여물 누적 방지 (세션22 보안 결함 정리)
  const registeredEmails: string[] = []

  test.afterAll(() => {
    if (registeredEmails.length === 0) return
    const r = spawnSync('node', [CLEANUP_SCRIPT, ...registeredEmails], { stdio: 'inherit' })
    if (r.status !== 0) {
      console.warn(`[seller-auth-invite] cleanup exit=${r.status}; ${registeredEmails.length} emails may remain`)
    }
  })
  // ── seller: 차단 케이스 ──────────────────────────────────────────

  test('seller + inviteToken 없음 → 403', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: {
        email: `sec-test-${Date.now()}@example.com`,
        password: 'password123',
        name: '테스트셀러',
        role: 'seller',
      },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.message).toContain('초대 토큰')
  })

  test('seller + 존재하지 않는 inviteToken → 403', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: {
        email: `sec-test-${Date.now()}@example.com`,
        password: 'password123',
        name: '테스트셀러',
        role: 'seller',
        inviteToken: 'INVALIDTOKEN0000',
      },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.message).toContain('유효하지 않은')
  })

  // ── consumer: 기존 동작 유지 ─────────────────────────────────────

  test('consumer + inviteToken 없음 → 201', async ({ request }) => {
    const email = `consumer-sec-${Date.now()}@example.com`
    const res = await request.post(`${API}/auth/register`, {
      data: { email, password: 'password123', name: '테스트소비자', role: 'consumer' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('userId')
    registeredEmails.push(email)
  })

  // ── driver: 기존 동작 유지 ───────────────────────────────────────

  test('driver + inviteToken 없음 → 201', async ({ request }) => {
    const email = `driver-sec-${Date.now()}@example.com`
    const res = await request.post(`${API}/auth/register`, {
      data: { email, password: 'password123', name: '테스트드라이버', role: 'driver' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('userId')
    registeredEmails.push(email)
  })
})
