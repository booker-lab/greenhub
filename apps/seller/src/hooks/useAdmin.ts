'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

// ── Types ────────────────────────────────────────────────────────

export interface AdminStore {
  id: string
  name: string
  ownerId: string
  status: string
  commissionRate?: number
  createdAt: unknown
}

export interface AdminUser {
  id: string
  email: string
  name: string
  phone?: string
  suspended?: boolean
  createdAt: unknown
}

export interface AdminOrder {
  id: string
  storeId: string
  userId: string
  status: string
  totalAmount: number
  deliveryMethod: string
  createdAt: unknown
}

export interface AdminSettlement {
  id: string
  storeId: string
  orderId: string
  totalAmount: number
  platformFee: number
  netAmount: number
  status: string
  settledAt: unknown
  paidAt: unknown | null
}

export interface InviteToken {
  token: string
  createdBy: string
  usedAt: string | null
  usedBy: string | null
  expiresAt: string | null
  createdAt: string | null
}

// ── Stores ───────────────────────────────────────────────────────

export function useAdminStores() {
  const { data: session } = useSession()
  const [stores, setStores] = useState<AdminStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/admin/stores', session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setStores(data.stores ?? [])
      } else {
        setError('판매자 목록 조회 실패')
      }
    } catch {
      setError('판매자 목록 조회 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken])

  useEffect(() => { load() }, [load])

  const setCommission = async (storeId: string, rate: number) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/stores/${storeId}/commission`, session.user.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ rate }),
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  return { stores, loading, error, reload: load, setCommission }
}

// ── Users ────────────────────────────────────────────────────────

export function useAdminUsers() {
  const { data: session } = useSession()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/admin/users', session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users ?? [])
      } else {
        setError('사용자 목록 조회 실패')
      }
    } catch {
      setError('사용자 목록 조회 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken])

  useEffect(() => { load() }, [load])

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/users/${userId}/status`, session.user.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ suspended }),
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  return { users, loading, error, reload: load, toggleSuspend }
}

// ── Orders ───────────────────────────────────────────────────────

export function useAdminOrders(filters?: { storeId?: string; status?: string }) {
  const { data: session } = useSession()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters?.storeId) params.set('storeId', filters.storeId)
      if (filters?.status) params.set('status', filters.status)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch(`/admin/orders${qs}`, session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.orders ?? [])
      } else {
        setError('주문 목록 조회 실패')
      }
    } catch {
      setError('주문 목록 조회 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken, filters?.storeId, filters?.status])

  useEffect(() => { load() }, [load])

  const forceRefund = async (orderId: string, reason?: string) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/orders/${orderId}/refund`, session.user.accessToken, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  return { orders, loading, error, reload: load, forceRefund }
}

// ── Settlements ──────────────────────────────────────────────────

export function useAdminSettlements(filters?: { storeId?: string; from?: string; to?: string }) {
  const { data: session } = useSession()
  const [settlements, setSettlements] = useState<AdminSettlement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters?.storeId) params.set('storeId', filters.storeId)
      if (filters?.from) params.set('from', filters.from)
      if (filters?.to) params.set('to', filters.to)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch(`/admin/settlements${qs}`, session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setSettlements(data.settlements ?? [])
      } else {
        setError('정산 목록 조회 실패')
      }
    } catch {
      setError('정산 목록 조회 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken, filters?.storeId, filters?.from, filters?.to])

  useEffect(() => { load() }, [load])

  const markAsPaid = async (settlementId: string) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/settlements/${settlementId}/pay`, session.user.accessToken, {
        method: 'PATCH',
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  return { settlements, loading, error, reload: load, markAsPaid }
}

// ── Drivers ──────────────────────────────────────────────────────

export type DriverStatus = 'all' | 'pending' | 'approved' | 'suspended'

export interface AdminDriver {
  id: string
  name: string
  email: string | null
  driverApproved: boolean
  suspended?: boolean
  createdAt: unknown
}

export function useAdminDrivers() {
  const { data: session } = useSession()
  const [drivers, setDrivers] = useState<AdminDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/admin/drivers', session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setDrivers(data.drivers ?? [])
      } else {
        setError('드라이버 목록 조회 실패')
      }
    } catch {
      setError('드라이버 목록 조회 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken])

  useEffect(() => { load() }, [load])

  const approve = async (userId: string) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/drivers/${userId}/approve`, session.user.accessToken, {
        method: 'PATCH',
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    if (!session?.user.accessToken) return false
    try {
      const res = await apiFetch(`/admin/drivers/${userId}/suspend`, session.user.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ suspended }),
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    }
  }

  return { drivers, loading, error, reload: load, approve, toggleSuspend }
}

// ── Banner ───────────────────────────────────────────────────────

export interface BannerCta {
  label: string
  href: string
}

export interface AdminBanner {
  imageUrl?: string
  tagText?: string
  headline?: string
  subText?: string
  cta1?: BannerCta
  cta2?: BannerCta
  isActive?: boolean
}

export function useAdminBanner() {
  const { data: session } = useSession()
  const [banner, setBanner] = useState<AdminBanner | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/admin/banner', session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setBanner(data)
      }
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken])

  useEffect(() => { load() }, [load])

  const save = async (dto: AdminBanner): Promise<boolean> => {
    if (!session?.user.accessToken) return false
    setSaving(true)
    // 서버 관리 필드 제거 (forbidNonWhitelisted 대응)
    const { updatedAt: _u, createdAt: _c, ...payload } = dto as AdminBanner & Record<string, unknown>
    try {
      const res = await apiFetch('/admin/banner', session.user.accessToken, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (res.ok) { await load(); return true }
      return false
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }

  return { banner, loading, saving, save, reload: load }
}

// ── Invite ───────────────────────────────────────────────────────

export function useAdminInvite() {
  const { data: session } = useSession()
  const [invites, setInvites] = useState<InviteToken[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const loadInvites = useCallback(async () => {
    if (!session?.user.accessToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/admin/invite', session.user.accessToken)
      if (res.ok) {
        const data = await res.json()
        setInvites(Array.isArray(data) ? data : [])
      }
    } finally {
      setLoading(false)
    }
  }, [session?.user.accessToken])

  useEffect(() => { loadInvites() }, [loadInvites])

  const generate = async (): Promise<{ token: string; expiresAt: string } | null> => {
    if (!session?.user.accessToken) return null
    setGenerating(true)
    try {
      const res = await apiFetch('/admin/invite', session.user.accessToken, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        await loadInvites()
        return data
      }
      return null
    } catch {
      return null
    } finally {
      setGenerating(false)
    }
  }

  return { invites, loading, generating, generate, reload: loadInvites }
}
