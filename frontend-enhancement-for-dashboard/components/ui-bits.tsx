'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { ApiError } from '@/lib/api'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div role="status" className="px-6 py-10 text-center text-xs text-[#8a8b86]">{label}</div>
}

export function ErrorBox({ error, onRetry }: { error: ApiError | string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : error.message
  return (
    <div role="alert" className="flex items-center justify-between gap-4 border-l-2 border-[#b84940] bg-[#f0f0ec] p-4 text-xs text-[#b84940]">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-4">Try again</button>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-10 text-center text-xs text-[#8a8b86]">{children}</div>
}

export function Pager({ page, pages, onPage, from, to, total }: { page: number; pages: number; onPage: (p: number) => void; from?: number; to?: number; total?: number }) {
  if (pages <= 1 && !total) return null
  const btn = 'border border-[#d3d3ce] px-3 py-1.5 text-xs disabled:opacity-40'
  return (
    <div className="flex items-center justify-between border-t border-[#deded9] px-6 py-4 text-xs text-[#777873]">
      <span>{total !== undefined && from !== undefined && to !== undefined ? `Showing ${from}–${to} of ${total.toLocaleString()}` : `Page ${page} of ${pages}`}</span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} / {Math.max(pages, 1)}</span>
        <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}

export function Modal({ children, onClose, label, wide }: { children: ReactNode; onClose: () => void; label: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17191b]/45 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`max-h-[92vh] w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} overflow-y-auto border border-[#deded9] bg-[#fbfbf9] p-7 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end"><button onClick={onClose} className="grid size-9 place-items-center border border-[#deded9]" aria-label="Close"><X className="size-4" /></button></div>
        {children}
      </div>
    </div>
  )
}
