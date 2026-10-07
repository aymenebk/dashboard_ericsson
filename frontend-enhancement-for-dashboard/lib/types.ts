// Shapes of the backend answers (see dashboard_ericsson/docs/openapi.yaml). Nothing here is computed by the frontend.

export type Condition = 'critical' | 'medium' | 'good' | 'no_data'
export type Role = 'admin' | 'viewer'

export interface User { id: string; email: string; role: Role }

export interface Thresholds { metric: string; mediumFrom: number; criticalFrom: number }

export interface SiteListItem {
  siteId: string
  neId: number
  neType: string
  wilayaCode: number | null
  wilayaName: string | null
  load: number | null
  condition: Condition
  noMeasurementReason: string | null
  lastUpdate: string
}

export interface WilayaStat {
  wilayaCode: number
  name: string | null
  total: number
  measured: number
  critical: number
  rate: number
  shareOfCritical: number
}

export interface Dashboard {
  scope: { import: string | null; asOf: string | null; latestUpdate: string | null }
  thresholds: Thresholds
  totals: { sites: number; measured: number; noData: number }
  byCondition: Record<Condition, { count: number; share: number }>
  topSites: SiteListItem[]
  bottomSites: SiteListItem[]
  wilayas: { criticalSites: number; top: WilayaStat[]; unassigned: { sites: number; critical: number } }
}

export interface SitesPage {
  results: number
  total: number
  page: number
  pages: number
  from: number
  to: number
  data: { scope: { import: string | null; asOf: string | null }; thresholds: Thresholds; sites: SiteListItem[] }
}

export interface WilayaOption { code: number; name: string | null; sites: number }

export interface ImportCounts { rowsTotal: number; valid: number; failed: number; rejected: number; skipped: number; withWarnings: number }

export interface ImportSummary {
  id: string
  number?: number
  fileName: string
  fileType: string
  importedAt: string
  status: string
  counts: ImportCounts
  sitesCount: number
  periodFrom: string | null
  periodTo: string | null
}

export interface ImportDetail extends ImportSummary {
  issues: { errors: number; warnings: number; byCode: Record<string, number> }
  days: { date: string; total: number; valid: number; failed: number }[]
}

export interface Paged<K extends string, T> {
  results: number
  total: number
  page: number
  pages: number
  data: Record<K, T[]>
}

export interface ImportRow {
  sourceRow: number
  neId: number
  neType: string
  wilayaCode: number | null
  measurePoint: string
  endTime: string
  status: string
  failure: string | null
  bins: number[]
  totalSeconds: number | null
  meanUtil: number | null
  p95: number | null
}

export interface ImportIssue { sourceRow: number; severity: 'error' | 'warning'; code: string; message: string }

export interface SiteLink {
  linkId: string
  measurePoint: string
  portRef: string | null
  label: string | null
  notInUse: boolean
  entityType: string | null
  endTime: string
  status: string
  failure: string | null
  load: number | null
  bins: number[]
  onLatestDay: boolean
  isWorst: boolean
}

export interface SiteDetailData {
  scope: { import: string | null; asOf: string | null }
  thresholds: Thresholds
  site: { id: string; neId: number; neType: string; wilayaCode: number | null; wilayaName: string | null }
  current: { lastUpdate: string; load: number | null; condition: Condition; failureReasons: string[]; noMeasurementReason: string | null }
  summary: { windowDays: number; measuredDays: number; average: number | null; maximum: number | null; minimum: number | null }
  history: { date: string; load: number | null; condition: Condition; measuredLinks: number; totalLinks: number }[]
  links: SiteLink[]
  report: { level: Condition; title: string; text: string }
}
