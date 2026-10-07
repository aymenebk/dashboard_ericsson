'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '@/lib/api'
import type { User } from '@/lib/types'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthState {
  status: Status
  user: User | null
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setStatus('anonymous')
  }, [])

  // A 401 on any protected call (expired token, disabled account...) ends the session
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear()
      setUser(null)
      setStatus('anonymous')
      setNotice('Your session has ended. Please log in again.')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  // On load / reload: a stored token is only trusted after the backend confirms it
  useEffect(() => {
    if (!tokenStore.get()) { setStatus('anonymous'); return }
    api<{ data: { user: User } }>('/auth/me')
      .then((r) => { setUser(r.data.user); setStatus('authenticated') })
      .catch(() => { tokenStore.clear(); setStatus('anonymous') })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; data: { user: User } }>('/auth/login', {
      method: 'POST',
      auth: false,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    tokenStore.set(r.token)
    setNotice(null)
    setUser(r.data.user)
    setStatus('authenticated')
  }, [])

  const value = useMemo(() => ({ status, user, notice, login, logout }), [status, user, notice, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
