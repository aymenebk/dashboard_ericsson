'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { ApiError } from '@/lib/api'

export default function LoginScreen() {
  const { login, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f7f5] px-4 py-10 text-[#17191b]">
      <form onSubmit={submit} className="w-full max-w-[420px] border border-[#deded9] border-t-[3px] border-t-[#17191b] bg-[#fbfbf9] px-8 pb-10 pt-12 shadow-[0_24px_60px_-28px_rgba(23,25,27,.28)] sm:px-11" aria-label="Log in">
        <img src="/ericsson-logo.png" alt="Ericsson" width={2578} height={528} className="mx-auto block h-auto w-[200px] select-none" draggable={false} />

        <div className="mt-11 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#92938e]">Network operations</p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-[-.04em]">Log in</h1>
          <p className="mx-auto mt-2 max-w-[290px] text-sm leading-6 text-[#7d7e79]">Use your operations account to open the capacity monitor.</p>
        </div>

        {notice && !error && <p role="status" className="mt-7 border-l-2 border-[#d8a22d] bg-[#f0f0ec] p-3 text-xs text-[#666762]">{notice}</p>}
        {error && <p role="alert" className="mt-7 border-l-2 border-[#b84940] bg-[#f0f0ec] p-3 text-xs text-[#b84940]">{error}</p>}

        <label className="mt-8 block text-[10px] font-bold uppercase tracking-[.12em] text-[#898a85]">Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="clean-input mt-2 !h-11 !bg-white" />
        </label>
        <label className="mt-5 block text-[10px] font-bold uppercase tracking-[.12em] text-[#898a85]">Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="clean-input mt-2 !h-11 !bg-white" />
        </label>
        <Button type="submit" disabled={busy} className="mt-8 h-11 w-full rounded-none bg-[#17191b] text-xs tracking-wide hover:bg-[#303234]">{busy ? 'Logging in…' : 'Log in'}</Button>
      </form>
      <p className="mt-6 text-[11px] text-[#9a9b96]">Global capacity monitor</p>
    </div>
  )
}
