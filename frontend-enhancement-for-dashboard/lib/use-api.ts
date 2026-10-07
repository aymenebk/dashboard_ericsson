'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

/** GET `path` (null = do not fetch). Refetches when the path changes; ignores answers that arrive too late. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    if (path === null) { setData(null); setLoading(false); return }
    const id = ++latest.current
    setLoading(true)
    setError(null)
    api<T>(path)
      .then((d) => { if (id === latest.current) { setData(d); setLoading(false) } })
      .catch((e) => {
        if (id !== latest.current || (e as Error).name === 'AbortError') return
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Something went wrong.'))
        setLoading(false)
      })
  }, [path, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
