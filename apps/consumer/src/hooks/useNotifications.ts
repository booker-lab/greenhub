'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import type { Notification } from '@greenhub/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const READ_KEY = 'gh_read_notifications'

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}

interface UseNotificationsResult {
  notifications: Notification[]
  readIds: Set<string>
  loading: boolean
  error: string | null
  markAllRead: () => void
  markRead: (id: string) => void
}

export function useNotifications(): UseNotificationsResult {
  const { data: session } = useSession()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const token = session?.user?.accessToken

  useEffect(() => {
    setReadIds(getReadIds())
  }, [])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchNotifications() {
      try {
        const res = await fetch(`${API_URL}/notifications/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled) return
        if (!res.ok) throw new Error(`조회 오류: ${res.status}`)
        const data = await res.json()
        setNotifications(data.items ?? [])
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchNotifications()
    return () => { cancelled = true }
  }, [token])

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev)
      notifications.forEach((n) => next.add(n.id))
      saveReadIds(next)
      return next
    })
  }, [notifications])

  return { notifications, readIds, loading, error, markAllRead, markRead }
}
