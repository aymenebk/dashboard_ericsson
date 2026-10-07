// The ONLY place that talks to the backend. The token lives in localStorage (the backend uses Bearer tokens,
// not cookies); it is never logged and never put in a URL.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1').replace(/\/+$/, '')

const TOKEN_KEY = 'fh_token'

export const tokenStore = {
  get(): string | null {
    try { return window.localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(token: string) {
    try { window.localStorage.setItem(TOKEN_KEY, token) } catch { /* storage blocked: the session lasts until reload */ }
  },
  clear() {
    try { window.localStorage.removeItem(TOKEN_KEY) } catch { /* nothing to clear */ }
  },
}

/** Error with a message that is safe to show to the user. `code` is the backend's machine-readable code. */
export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  details?: unknown
  constructor(status: number, code: string, message: string, requestId?: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

let onUnauthorized: (() => void) | null = null
/** The auth provider registers here: any 401 on a protected call logs the user out. */
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn }

// Backend messages for 4xx are written for humans and never contain internals. 5xx and network errors are generic.
function friendly(status: number, backendMessage: string | undefined, retryAfter?: string | null): string {
  switch (status) {
    case 401: return backendMessage || 'Your session has expired. Please log in again.'
    case 403: return 'You do not have permission to do this.'
    case 413: return backendMessage || 'The file is too large (maximum 10 MB).'
    case 429: return `Too many requests. Please wait${retryAfter ? ` ${retryAfter} seconds` : ' a moment'} and try again.`
    case 503: return 'The service is temporarily unavailable. Please try again shortly.'
    default:
      if (status >= 500) return 'Something went wrong on the server. Please try again.'
      return backendMessage || 'The request could not be completed.'
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { code?: string; message?: string; requestId?: string; details?: unknown } = {}
  try { body = await res.json() } catch { /* not JSON */ }
  const retryAfter = res.status === 429 ? res.headers.get('Retry-After') : null // only readable cross-origin because the backend exposes it
  return new ApiError(res.status, body.code || `HTTP_${res.status}`, friendly(res.status, body.message, retryAfter), body.requestId, body.details)
}

const networkError = () => new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check that the backend is running and try again.')

export async function api<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = true, headers, ...rest } = init
  const h = new Headers(headers)
  const token = tokenStore.get()
  if (auth && token) h.set('Authorization', `Bearer ${token}`)
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...rest, headers: h })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw networkError()
  }
  if (!res.ok) {
    const err = await toApiError(res)
    if (res.status === 401 && auth) onUnauthorized?.()
    throw err
  }
  return (await res.json()) as T
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') p.set(k, String(v)) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Upload with progress (fetch cannot report upload progress). */
export function uploadImport(file: File, onProgress: (percent: number) => void): Promise<{ data: { import: import('./types').ImportSummary } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/imports`)
    const token = tokenStore.get()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onerror = () => reject(networkError())
    xhr.onload = () => {
      let body: { code?: string; message?: string; requestId?: string; details?: unknown } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as never)
      if (xhr.status === 401) onUnauthorized?.()
      reject(new ApiError(xhr.status, body.code || `HTTP_${xhr.status}`, friendly(xhr.status, body.message, xhr.status === 429 ? xhr.getResponseHeader('Retry-After') : null), body.requestId, body.details))
    }
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
