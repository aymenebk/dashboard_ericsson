'use client'

import { AuthProvider, useAuth } from '@/components/auth-provider'
import LoginScreen from '@/components/login-screen'
import NetworkDashboard from '@/components/network-dashboard'

function Gate() {
  const { status } = useAuth()
  if (status === 'loading') {
    return <div className="grid min-h-screen place-items-center bg-[#f7f7f5] text-xs text-[#8a8b86]" role="status">Loading…</div>
  }
  return status === 'authenticated' ? <NetworkDashboard /> : <LoginScreen />
}

export default function Page() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
