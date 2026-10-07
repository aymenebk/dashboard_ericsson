'use client'

import { useState } from 'react'
import { qs } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { CONDITION_BG, CONDITION_LABEL, CONDITION_TEXT, fmtDay, fmtDayShort, fmtPct, noMeasurementText } from '@/lib/format'
import type { SiteDetailData } from '@/lib/types'
import { ErrorBox, Loading, Modal } from '@/components/ui-bits'

const SLICES = Array.from({ length: 20 }, (_, i) => `${i * 5}–${i * 5 + 5}%`)

/** Site page. Every figure comes from the backend; the frontend only draws it. */
export default function SiteDetails({ siteId, date, onClose }: { siteId: string; date: string; onClose: () => void }) {
  const detail = useApi<{ data: SiteDetailData }>(`/sites/${siteId}${qs({ date })}`)
  const [linkId, setLinkId] = useState<string | null>(null)
  const d = detail.data?.data

  return (
    <Modal label="Site details" onClose={onClose}>
      {detail.loading ? <Loading /> : detail.error ? <ErrorBox error={detail.error} onRetry={detail.reload} /> : d && (() => {
        const link = d.links.find((l) => l.linkId === linkId) ?? d.links.find((l) => l.isWorst) ?? d.links[0]
        const c = d.current.condition
        const max = Math.max(...(link?.bins ?? [1]), 1)
        const total = (link?.bins ?? []).reduce((a, b) => a + b, 0)
        return (
          <div>
            <div className="border-b border-[#deded9] pb-6">
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#92938e]">Site intelligence / {d.site.neId}</p>
              <h2 className="mt-3 text-3xl font-semibold">{d.site.neId}</h2>
              <p className="mt-1 text-sm text-[#777873]">{d.site.wilayaName ?? 'Wilaya unknown'} · {d.site.neType}</p>
            </div>

            <div className="mt-6 grid gap-0 border-b border-l border-t border-[#deded9] sm:grid-cols-3">
              {[['Site ID', String(d.site.neId)], ['Wilaya', d.site.wilayaName ?? '—'], ['Condition', CONDITION_LABEL[c]], ['NE type', d.site.neType], ['Measure point', link?.portRef ?? link?.measurePoint ?? '—'], ['End time', fmtDay(d.current.lastUpdate)]].map(([label, value]) => (
                <div key={label} className="border-b border-r border-[#deded9] p-4">
                  <p className="text-[10px] uppercase tracking-[.1em] text-[#92938e]">{label}</p>
                  <p className={`mt-2 text-sm font-semibold ${label === 'Condition' ? CONDITION_TEXT[c] : ''}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 border border-[#deded9] p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Load summary</h3>
                  <p className="mt-1 text-xs text-[#898a85]">95th percentile of the day · last {d.summary.windowDays} day(s) with data</p>
                </div>
                <span className={`text-2xl font-semibold ${CONDITION_TEXT[c]}`}>{fmtPct(d.current.load, 2)}</span>
              </div>
              <div className="mt-5 h-1 bg-[#deded9]"><div className={`h-full ${CONDITION_BG[c]}`} style={{ width: `${d.current.load ?? 0}%` }} /></div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs">
                <div><p className="text-[#92938e]">Average</p><strong>{fmtPct(d.summary.average, 2)}</strong></div>
                <div><p className="text-[#92938e]">Maximum</p><strong>{fmtPct(d.summary.maximum, 2)}</strong></div>
                <div><p className="text-[#92938e]">Minimum</p><strong>{fmtPct(d.summary.minimum, 2)}</strong></div>
              </div>
              {d.current.load === null && <div className="mt-4 border-t border-[#deded9] pt-4 text-xs"><p className="text-[10px] uppercase tracking-[.1em] text-[#92938e]">Measurement</p><p className="mt-1 font-semibold">No measurement</p><p className="mt-3 text-[10px] uppercase tracking-[.1em] text-[#92938e]">Reason</p><p className="mt-1 font-semibold text-[#b84940]">{noMeasurementText(d.current.noMeasurementReason)}</p></div>}
            </div>

            <div className="mt-6 border border-[#deded9] p-5">
              <h3 className="text-sm font-semibold">Load by day</h3>
              <div className="mt-5 flex h-32 items-end gap-2 border-b border-l border-[#deded9] px-3">
                {d.history.map((h) => (
                  <div key={h.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${fmtDay(h.date)}: ${h.load === null ? 'no measurement' : fmtPct(h.load, 2)}`}>
                    <div className={`w-full ${CONDITION_BG[h.condition]}`} style={{ height: h.load === null ? '4%' : `${Math.max(h.load, 2)}%`, opacity: h.load === null ? 0.4 : 0.85 }} />
                    <span className="text-[10px] text-[#92938e]">{fmtDayShort(h.date)}</span>
                  </div>
                ))}
              </div>
            </div>

            {link && (
              <div className="mt-6 border border-[#deded9] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Utilization histogram · 20 slices</h3>
                    <p className="mt-1 text-xs text-[#898a85]">Seconds spent in each 5% utilization slice on {fmtDay(link.endTime)}{total ? ` (${total.toLocaleString()} s)` : ''}</p>
                  </div>
                  {d.links.length > 1 && (
                    <select aria-label="Link" value={link.linkId} onChange={(e) => setLinkId(e.target.value)} className="clean-input !h-8 !w-auto max-w-[260px] text-xs">
                      {d.links.map((l) => <option key={l.linkId} value={l.linkId}>{l.portRef ?? l.measurePoint}{l.isWorst ? ' (worst)' : ''}{l.load === null ? ' — no measurement' : ''}</option>)}
                    </select>
                  )}
                </div>
                {link.status !== 'OK' ? (
                  <p className="mt-4 text-xs text-[#b84940]">No measurement for this link: {noMeasurementText(link.failure ?? link.status)}</p>
                ) : (
                  <div className="mt-5 flex h-36 items-end gap-[3px] border-b border-l border-[#deded9] px-2" role="img" aria-label="Histogram of the 20 utilization slices">
                    {link.bins.map((v, i) => (
                      <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${SLICES[i]}: ${v.toLocaleString()} s`}>
                        <div className={i * 5 >= d.thresholds.criticalFrom ? 'w-full bg-[#b84940]' : i * 5 >= d.thresholds.mediumFrom ? 'w-full bg-[#d8a22d]' : 'w-full bg-[#2d9361]'} style={{ height: `${Math.max((v / max) * 100, v > 0 ? 2 : 0)}%` }} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex justify-between px-2 text-[10px] text-[#92938e]"><span>0%</span><span>50%</span><span>100%</span></div>
                <p className="mt-3 text-[11px] text-[#898a85]">Link {link.measurePoint}{link.notInUse ? ' · not in use' : ''}</p>
              </div>
            )}

            <div className={`mt-6 border-l-2 bg-[#f0f0ec] p-4 text-xs leading-5 text-[#666762] ${c === 'critical' ? 'border-[#b84940]' : c === 'medium' ? 'border-[#d8a22d]' : c === 'good' ? 'border-[#2d9361]' : 'border-[#9a9b96]'}`}>
              <strong className="block text-[#17191b]">{d.report.title}</strong>{d.report.text}
            </div>
          </div>
        )
      })()}
    </Modal>
  )
}
