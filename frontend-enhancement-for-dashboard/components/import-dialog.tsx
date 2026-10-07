'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError, uploadImport } from '@/lib/api'
import type { ImportSummary } from '@/lib/types'
import ImportDetailView from '@/components/import-detail'
import { RevertButton } from '@/components/history-page'
import { Modal } from '@/components/ui-bits'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = /\.(xlsx|csv)$/i

type Phase = 'choose' | 'uploading' | 'done'

/**
 * The backend imports in ONE step (upload -> read -> validate -> store, all or nothing), so there is no
 * separate "commit": when the answer comes back the data is already stored. The dialog shows exactly what
 * the backend reports, and "Cancel import" reverts it (DELETE /imports/:id).
 */
export default function ImportDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('choose')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [result, setResult] = useState<ImportSummary | null>(null)

  const pick = (f: File | null) => {
    setError(null)
    if (!f) return setFile(null)
    if (!ALLOWED.test(f.name)) return setError({ message: 'Only .xlsx and .csv files can be imported.' })
    if (f.size > MAX_BYTES) return setError({ message: 'This file is larger than 10 MB, the maximum allowed.' })
    setFile(f)
  }

  const start = async () => {
    if (!file) return
    setPhase('uploading')
    setProgress(0)
    setError(null)
    try {
      const r = await uploadImport(file, setProgress)
      setResult(r.data.import)
      setPhase('done')
      onChanged() // the dashboard and the lists refresh behind the dialog
    } catch (e) {
      const err = e instanceof ApiError ? e : null
      const missing = err?.code === 'EXCEL_MISSING_COLUMNS' && Array.isArray((err.details as { missing?: string[] })?.missing) ? (err.details as { missing: string[] }).missing.join(', ') : undefined
      setError({
        message: err?.message ?? 'The import failed.',
        hint: missing ? `Missing columns: ${missing}` : err?.code === 'IMPORT_DUPLICATE_FILE' ? 'Cancel the earlier import from the history page if you want to import this file again.' : undefined,
      })
      setPhase('choose')
    }
  }

  return (
    <Modal label="Import data" onClose={onClose} wide={phase === 'done'}>
      <div className="border-b border-[#deded9] pb-5">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#92938e]">Import data</p>
        <h2 className="mt-2 text-2xl font-semibold">{phase === 'done' ? 'Import completed' : 'Upload a measurement file'}</h2>
        <p className="mt-1 text-xs text-[#777873]">{phase === 'done' ? 'Review what the backend found. The data is already stored.' : 'Excel (.xlsx) or CSV, 10 MB maximum. The file is validated row by row; nothing is stored if the import fails.'}</p>
      </div>

      {phase !== 'done' && (
        <div className="mt-6">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null) }}
            className="grid place-items-center gap-3 border border-dashed border-[#bfc0bb] bg-[#f7f7f5] px-6 py-10 text-center"
          >
            <Upload className="size-5 text-[#777873]" />
            <p className="text-sm">{file ? <><strong>{file.name}</strong> <span className="text-[#7d7e79]">· {(file.size / 1024).toFixed(0)} KB</span></> : 'Drop a file here, or choose one'}</p>
            <input ref={input} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Choose a file to import" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <Button variant="outline" disabled={phase === 'uploading'} onClick={() => input.current?.click()} className="h-9 rounded-none border-[#cfcfca] bg-transparent text-xs">Choose file</Button>
          </div>

          {phase === 'uploading' && (
            <div className="mt-5" role="status">
              <div className="h-1 bg-[#deded9]"><div className="h-full bg-[#17191b] transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-2 text-xs text-[#777873]">{progress < 100 ? `Uploading… ${progress}%` : 'Validating and storing rows…'}</p>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-5 border-l-2 border-[#b84940] bg-[#f0f0ec] p-4 text-xs text-[#b84940]">
              <p className="font-semibold">{error.message}</p>
              {error.hint && <p className="mt-1 text-[#666762]">{error.hint}</p>}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} className="h-9 rounded-none border-[#cfcfca] bg-transparent text-xs">Close</Button>
            <Button disabled={!file || phase === 'uploading'} onClick={start} className="h-9 rounded-none bg-[#17191b] px-4 text-xs hover:bg-[#303234]">{phase === 'uploading' ? 'Importing…' : 'Import'}</Button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="mt-6">
          <ImportDetailView id={result.id} />
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-[#deded9] pt-5">
            <RevertButton id={result.id} onDone={() => { onChanged(); onClose() }} />
            <Button onClick={onClose} className="h-9 rounded-none bg-[#17191b] px-4 text-xs hover:bg-[#303234]">Keep import</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
