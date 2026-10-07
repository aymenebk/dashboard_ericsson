'use client'

import { useEffect, useState } from 'react'
import { qs } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { fmtDay } from '@/lib/format'
import type { ImportDetail, ImportIssue, ImportRow, Paged } from '@/lib/types'
import { Empty, ErrorBox, Loading, Pager } from '@/components/ui-bits'

const tab = (active: boolean) => `border px-3 py-1.5 text-xs ${active ? 'border-[#17191b] bg-[#17191b] text-white' : 'border-[#d3d3ce]'}`

/** What the backend found in one import: totals, issues, days, and the stored rows (preview). */
export default function ImportDetailView({ id }: { id: string }) {
  const detail = useApi<{ data: { import: ImportDetail } }>(`/imports/${id}`)
  const [tabName, setTabName] = useState<'rows' | 'issues' | 'days'>('rows')

  if (detail.loading) return <Loading />
  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />
  const imp = detail.data?.data.import
  if (!imp) return null
  const c = imp.counts

  return (
    <div>
      <div className="grid border-b border-l border-t border-[#deded9] sm:grid-cols-3 lg:grid-cols-6">
        {[['Rows', c.rowsTotal], ['Valid', c.valid], ['Failed (PM)', c.failed], ['Rejected', c.rejected], ['Skipped', c.skipped], ['Sites', imp.sitesCount]].map(([label, value]) => (
          <div key={label as string} className="border-b border-r border-[#deded9] p-4">
            <p className="text-[10px] uppercase tracking-[.1em] text-[#92938e]">{label}</p>
            <p className={`mt-2 text-lg font-semibold ${label === 'Rejected' && value ? 'text-[#b84940]' : ''}`}>{(value as number).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[#7d7e79]">{imp.fileName} · data from {fmtDay(imp.periodFrom)} to {fmtDay(imp.periodTo)} · {imp.issues.warnings} warning(s), {imp.issues.errors} error(s)</p>

      <div className="mt-6 flex gap-2">
        <button className={tab(tabName === 'rows')} onClick={() => setTabName('rows')}>Rows</button>
        <button className={tab(tabName === 'issues')} onClick={() => setTabName('issues')}>Issues ({imp.issues.errors + imp.issues.warnings})</button>
        <button className={tab(tabName === 'days')} onClick={() => setTabName('days')}>Days</button>
      </div>

      <div className="mt-4 border border-[#deded9]">
        {tabName === 'rows' && <RowsTable id={id} />}
        {tabName === 'issues' && <IssuesTable id={id} />}
        {tabName === 'days' && (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#deded9] text-[10px] uppercase tracking-[.12em] text-[#92938e]"><tr><th className="px-4 py-3">Day</th><th className="px-4 py-3">Rows</th><th className="px-4 py-3">Valid</th><th className="px-4 py-3">Failed</th></tr></thead>
            <tbody className="divide-y divide-[#e5e5e1]">{imp.days.map((d) => <tr key={d.date}><td className="px-4 py-3 font-semibold">{fmtDay(d.date)}</td><td className="px-4 py-3">{d.total}</td><td className="px-4 py-3 text-[#2d9361]">{d.valid}</td><td className="px-4 py-3 text-[#b84940]">{d.failed}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function RowsTable({ id }: { id: string }) {
  const [filter, setFilter] = useState<'all' | 'valid' | 'failed'>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [filter, q])
  const path = `/imports/${id}/rows${qs({ filter, q: /^\d+$/.test(q) ? q : '', page, limit: 10 })}`
  const rows = useApi<Paged<'rows', ImportRow>>(path)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#deded9] px-4 py-3">
        {(['all', 'valid', 'failed'] as const).map((f) => <button key={f} className={tab(filter === f)} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        <input value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ''))} placeholder="NeId" inputMode="numeric" aria-label="Filter rows by NeId" className="clean-input ml-auto !h-8 !w-32 text-xs" />
      </div>
      {rows.loading ? <Loading /> : rows.error ? <ErrorBox error={rows.error} onRetry={rows.reload} /> : !rows.data || rows.data.data.rows.length === 0 ? <Empty>No row matches.</Empty> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-[#deded9] text-[10px] uppercase tracking-[.12em] text-[#92938e]"><tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">NeId</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Measure point</th><th className="px-4 py-3">Day</th><th className="px-4 py-3">Result</th></tr></thead>
              <tbody className="divide-y divide-[#e5e5e1]">
                {rows.data.data.rows.map((r) => (
                  <tr key={r.sourceRow}>
                    <td className="px-4 py-3 text-[#92938e]">{r.sourceRow}</td>
                    <td className="px-4 py-3 font-semibold">{r.neId}</td>
                    <td className="px-4 py-3">{r.neType}</td>
                    <td className="max-w-[220px] truncate px-4 py-3" title={r.measurePoint}>{r.measurePoint}</td>
                    <td className="px-4 py-3">{fmtDay(r.endTime)}</td>
                    <td className="px-4 py-3">{r.status === 'OK' ? <span className="text-[#2d9361]">P95 {r.p95?.toFixed(2)}%</span> : <span className="text-[#b84940]" title={r.failure ?? ''}>{r.status.replace(/_/g, ' ').toLowerCase()}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={rows.data.page} pages={rows.data.pages} onPage={setPage} total={rows.data.total} from={(rows.data.page - 1) * 10 + 1} to={(rows.data.page - 1) * 10 + rows.data.results} />
        </>
      )}
    </div>
  )
}

function IssuesTable({ id }: { id: string }) {
  const [severity, setSeverity] = useState<'' | 'error' | 'warning'>('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [severity])
  const issues = useApi<Paged<'issues', ImportIssue>>(`/imports/${id}/issues${qs({ severity, page, limit: 10 })}`)

  return (
    <div>
      <div className="flex gap-2 border-b border-[#deded9] px-4 py-3">
        {([['', 'All'], ['error', 'Errors'], ['warning', 'Warnings']] as const).map(([v, l]) => <button key={l} className={tab(severity === v)} onClick={() => setSeverity(v)}>{l}</button>)}
      </div>
      {issues.loading ? <Loading /> : issues.error ? <ErrorBox error={issues.error} onRetry={issues.reload} /> : !issues.data || issues.data.data.issues.length === 0 ? <Empty>No issue found.</Empty> : (
        <>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#deded9] text-[10px] uppercase tracking-[.12em] text-[#92938e]"><tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Message</th></tr></thead>
            <tbody className="divide-y divide-[#e5e5e1]">
              {issues.data.data.issues.map((i, n) => (
                <tr key={`${i.sourceRow}-${i.code}-${n}`}>
                  <td className="px-4 py-3 text-[#92938e]">{i.sourceRow}</td>
                  <td className={`px-4 py-3 font-semibold ${i.severity === 'error' ? 'text-[#b84940]' : 'text-[#c98a0a]'}`}>{i.severity}</td>
                  <td className="px-4 py-3">{i.code}</td>
                  <td className="px-4 py-3 text-[#7d7e79]">{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={issues.data.page} pages={issues.data.pages} onPage={setPage} total={issues.data.total} from={(issues.data.page - 1) * 10 + 1} to={(issues.data.page - 1) * 10 + issues.data.results} />
        </>
      )}
    </div>
  )
}
