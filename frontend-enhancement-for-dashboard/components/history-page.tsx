'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { api, ApiError, qs } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { fmtDateTime } from '@/lib/format'
import type { ImportSummary, Paged } from '@/lib/types'
import ImportDetailView from '@/components/import-detail'
import { Empty, ErrorBox, Loading, Modal, Pager } from '@/components/ui-bits'

/** Cancel (revert) an import. The backend removes the data the import brought; the caller refreshes afterwards. */
export function RevertButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/imports/${id}`, { method: 'DELETE' })
      onDone()
    } catch (e) {
      // 404: someone else already reverted it: the list is simply out of date
      if (e instanceof ApiError && e.status === 404) return onDone()
      setError(e instanceof ApiError ? e.message : 'Could not cancel the import.')
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#777873]">Remove this import and its data?</span>
          <button disabled={busy} onClick={run} className="border border-[#b84940] bg-[#b84940] px-3 py-1.5 text-white disabled:opacity-50">{busy ? 'Cancelling…' : 'Yes, cancel import'}</button>
          <button disabled={busy} onClick={() => setConfirming(false)} className="border border-[#d3d3ce] px-3 py-1.5">Keep</button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="border border-[#b84940] px-3 py-1.5 text-xs text-[#b84940] hover:bg-[#f0f0ec]">Cancel import</button>
      )}
      {error && <p role="alert" className="text-xs text-[#b84940]">{error}</p>}
    </div>
  )
}

function exportCsv(items: ImportSummary[]) {
  const head = ['number', 'file', 'imported_at', 'rows', 'valid', 'failed', 'rejected', 'sites', 'status']
  const lines = items.map((i) => [i.number, JSON.stringify(i.fileName), i.importedAt, i.counts.rowsTotal, i.counts.valid, i.counts.failed, i.counts.rejected, i.sitesCount, i.status].join(','))
  const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'import-history.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function HistoryPage({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ImportSummary | null>(null)
  const list = useApi<Paged<'imports', ImportSummary>>(`/imports${qs({ page, limit: 10 })}`)
  const reloadList = list.reload
  useEffect(() => { if (refreshKey) reloadList() }, [refreshKey, reloadList])

  const items = list.data?.data.imports ?? []
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#92938e]">Dashboard / History</p>
      <h1 className="mt-3 text-[34px] font-semibold tracking-[-.045em]">Import history</h1>
      <p className="mt-2 max-w-xl text-sm text-[#7d7e79]">Every import with its date and hour. Open one to review its rows and issues.</p>

      <div className="mt-8 border border-[#deded9] bg-[#fbfbf9] p-6">
        <div className="flex items-center justify-between border-b border-[#deded9] pb-5">
          <h2 className="text-sm font-semibold">Recent imports</h2>
          <Button variant="outline" disabled={items.length === 0} onClick={() => exportCsv(items)} className="h-9 rounded-none border-[#cfcfca] bg-transparent text-xs"><Download data-icon="inline-start" />Export log</Button>
        </div>
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : items.length === 0 ? <Empty>No import yet. Use “Import data” to upload your first file.</Empty> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead className="border-b border-[#deded9] text-[10px] uppercase tracking-[.12em] text-[#92938e]"><tr><th className="px-4 py-4">#</th><th className="px-4 py-4">File</th><th className="px-4 py-4">Imported on</th><th className="px-4 py-4">Sites</th><th className="px-4 py-4">Valid / failed</th><th className="px-4 py-4">Status</th><th className="px-4 py-4 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-[#e5e5e1]">
                  {items.map((r) => (
                    <tr key={r.id} className="hover:bg-[#f0f0ec]">
                      <td className="px-4 py-5 text-xs text-[#92938e]">{r.number}</td>
                      <td className="px-4 py-5 text-sm font-semibold">{r.fileName}</td>
                      <td className="px-4 py-5 text-xs text-[#7d7e79]">{fmtDateTime(r.importedAt)}</td>
                      <td className="px-4 py-5 text-sm">{r.sitesCount.toLocaleString()}</td>
                      <td className="px-4 py-5 text-xs">{r.counts.valid.toLocaleString()} / {r.counts.failed.toLocaleString()}</td>
                      <td className="px-4 py-5 text-xs font-semibold capitalize text-[#2d9361]">{r.status}</td>
                      <td className="px-4 py-5 text-right"><button onClick={() => setOpen(r)} className="text-xs underline underline-offset-4">View details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={list.data!.page} pages={list.data!.pages} onPage={setPage} />
          </>
        )}
      </div>

      {open && (
        <Modal label={`Import ${open.fileName}`} onClose={() => setOpen(null)} wide>
          <div className="flex items-start justify-between gap-4 border-b border-[#deded9] pb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#92938e]">Import #{open.number}</p>
              <h2 className="mt-2 text-2xl font-semibold">{open.fileName}</h2>
              <p className="mt-1 text-xs text-[#777873]">Imported {fmtDateTime(open.importedAt)}</p>
            </div>
            {user?.role === 'admin' && <RevertButton id={open.id} onDone={() => { setOpen(null); setPage(1); onChanged(); list.reload() }} />}
          </div>
          <div className="mt-6"><ImportDetailView id={open.id} /></div>
        </Modal>
      )}
    </div>
  )
}
