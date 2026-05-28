/**
 * ContentPulse — Freshness Dashboard
 *
 * Full-page admin view listing all monitored content sorted by
 * freshness score, with severity filtering and one-click re-analyze.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Flex,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Typography,
  Badge,
  Select,
  Option,
  Loader,
  EmptyStateLayout,
} from '@strapi/design-system'
import { ArrowLeft, Refresh } from '@strapi/icons'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PulseWarning {
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
  originalText: string
  suggestion?: string
}

interface FreshEntry {
  id: number | string
  documentId: string
  contentType: string
  title?: string
  score: number
  warnings: PulseWarning[]
  lastAnalyzedAt: string | null
}

type FilterValue = 'all' | 'critical' | 'stale' | 'fresh'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const scoreColor = (score: number) => {
  if (score >= 80) return '#4ade80'
  if (score >= 60) return '#fbbf24'
  if (score >= 40) return '#fb923c'
  return '#ef4444'
}

const scoreLabel = (score: number) => {
  if (score >= 80) return 'Fresh'
  if (score >= 60) return 'Aging'
  if (score >= 40) return 'Stale'
  return 'Critical'
}

const maxSeverity = (warnings: PulseWarning[]): PulseWarning['severity'] | null => {
  const order: PulseWarning['severity'][] = ['critical', 'high', 'medium', 'low']
  for (const s of order) {
    if (warnings.some((w) => w.severity === s)) return s
  }
  return null
}

const severityBadgeColor: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#84cc16',
}

// ─── Data Fetcher ─────────────────────────────────────────────────────────────

async function fetchFreshness(signal?: AbortSignal): Promise<FreshEntry[]> {
  const res = await fetch('/api/content-pulse/dashboard', {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!res.ok) throw new Error(`ContentPulse API error: ${res.status}`)

  const json = await res.json()
  return (json.data ?? []) as FreshEntry[]
}

async function reanalyzeEntry(entry: FreshEntry): Promise<FreshEntry> {
  const res = await fetch(
    `/api/content-pulse/reanalyze/${encodeURIComponent(entry.contentType)}/${entry.documentId}`,
    { method: 'POST', headers: { Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Re-analyze failed: ${res.status}`)
  const json = await res.json()
  return { ...entry, ...json.data }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FreshnessDashboard: React.FC = () => {
  const [entries, setEntries] = useState<FreshEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [reanalyzing, setReanalyzing] = useState<Set<string>>(new Set())
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const load = useCallback(async (ac?: AbortController) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFreshness(ac?.signal)
      setEntries(data)
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setError((err as Error).message ?? 'Failed to load freshness data')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac)
    return () => ac.abort()
  }, [load])

  const handleReanalyze = async (entry: FreshEntry) => {
    const key = `${entry.contentType}:${entry.documentId}`
    setReanalyzing((s) => new Set(s).add(key))
    try {
      const updated = await reanalyzeEntry(entry)
      setEntries((prev) => prev.map((e) => (e.documentId === entry.documentId ? updated : e)))
    } catch (err) {
      console.error('[ContentPulse] Re-analyze error:', err)
    } finally {
      setReanalyzing((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
    }
  }

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const token = (window as unknown as Record<string, Record<string, string>>).__STRAPI_DATA__?.token
        ?? localStorage.getItem('jwtToken')
        ?? ''
      const res = await fetch(`/api/content-pulse/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contentpulse-export.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[ContentPulse] Export error:', err)
    }
  }

  // ── Filter + Sort ────────────────────────────────────────────────────────
  const filtered = entries
    .filter((e) => {
      if (filter === 'critical') return e.score < 40
      if (filter === 'stale') return e.score < 80
      if (filter === 'fresh') return e.score >= 80
      return true
    })
    .sort((a, b) => (sortDir === 'asc' ? a.score - b.score : b.score - a.score))

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = {
    total: entries.length,
    fresh: entries.filter((e) => e.score >= 80).length,
    stale: entries.filter((e) => e.score < 80 && e.score >= 40).length,
    critical: entries.filter((e) => e.score < 40).length,
    avgScore:
      entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length) : 0,
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Box padding={8} background="neutral100" minHeight="100vh">
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box>
          <Typography variant="alpha" fontWeight="bold">
            🫀 ContentPulse — Freshness Dashboard
          </Typography>
          <Typography variant="epsilon" textColor="neutral600" marginTop={1} display="block">
            Semantic decay overview across all monitored collections
          </Typography>
        </Box>
        <Button
          variant="secondary"
          startIcon={<Refresh />}
          onClick={() => load()}
          loading={loading}
        >
          Refresh
        </Button>
          <Button variant="secondary" onClick={() => handleExport('csv')}>
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => handleExport('json')}>
            Export JSON
          </Button>
      </Flex>

      {/* Stats row */}
      <Flex gap={4} marginBottom={6}>
        {[
          { label: 'Total Docs', value: stats.total, color: 'neutral700' },
          { label: 'Avg Score', value: `${stats.avgScore}/100`, color: scoreColor(stats.avgScore) },
          { label: '✓ Fresh', value: stats.fresh, color: '#4ade80' },
          { label: '⚠ Stale', value: stats.stale, color: '#fbbf24' },
          { label: '✕ Critical', value: stats.critical, color: '#ef4444' },
        ].map((s) => (
          <Box
            key={s.label}
            padding={4}
            background="neutral0"
            borderRadius="8px"
            flex="1"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}
          >
            <Typography variant="pi" textColor="neutral500">
              {s.label}
            </Typography>
            <Typography
              variant="alpha"
              fontWeight="bold"
              display="block"
              marginTop={1}
              style={{ color: s.color }}
            >
              {s.value}
            </Typography>
          </Box>
        ))}
      </Flex>

      {/* Filters */}
      <Flex gap={3} marginBottom={4} alignItems="center">
        <Select
          label="Filter"
          value={filter}
          onChange={(v: FilterValue) => setFilter(v)}
          size="S"
        >
          <Option value="all">All documents</Option>
          <Option value="fresh">Fresh (≥ 80)</Option>
          <Option value="stale">Stale (&lt; 80)</Option>
          <Option value="critical">Critical (&lt; 40)</Option>
        </Select>

        <Button
          variant="ghost"
          size="S"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        >
          Score {sortDir === 'asc' ? '↑' : '↓'}
        </Button>

        <Typography variant="pi" textColor="neutral500">
          {filtered.length} of {entries.length} shown
        </Typography>
      </Flex>

      {/* Table */}
      {loading ? (
        <Flex justifyContent="center" padding={12}>
          <Loader>Loading freshness data…</Loader>
        </Flex>
      ) : error ? (
        <Box padding={6} background="danger100" borderRadius="8px">
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <EmptyStateLayout
          icon={<ArrowLeft />}
          content="No documents match the current filter."
          action={
            <Button variant="secondary" onClick={() => setFilter('all')}>
              Show all
            </Button>
          }
        />
      ) : (
        <Box background="neutral0" borderRadius="8px" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <Table colCount={6} rowCount={filtered.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Content Type
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Title / ID
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Score
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Worst Warning
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Last Analyzed
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma" textColor="neutral600">
                    Actions
                  </Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((entry) => {
                const key = `${entry.contentType}:${entry.documentId}`
                const isReanalyzing = reanalyzing.has(key)
                const worst = maxSeverity(entry.warnings)
                const shortType = entry.contentType.split('::').pop()?.split('.').pop() ?? entry.contentType

                return (
                  <Tr key={key}>
                    <Td>
                      <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
                        {shortType}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography variant="omega" textColor="neutral600">
                        {entry.title ?? entry.documentId}
                      </Typography>
                    </Td>
                    <Td>
                      <Flex alignItems="center" gap={2}>
                        {/* Mini score bar */}
                        <Box
                          background="neutral200"
                          height="6px"
                          borderRadius="3px"
                          width="60px"
                          overflow="hidden"
                        >
                          <Box
                            background={scoreColor(entry.score)}
                            height="100%"
                            width={`${entry.score}%`}
                            borderRadius="3px"
                          />
                        </Box>
                        <Typography
                          variant="omega"
                          fontWeight="bold"
                          style={{ color: scoreColor(entry.score), minWidth: 28 }}
                        >
                          {entry.score}
                        </Typography>
                        <Typography variant="pi" textColor="neutral400">
                          {scoreLabel(entry.score)}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      {worst ? (
                        <Badge
                          style={{
                            backgroundColor: severityBadgeColor[worst],
                            color: '#fff',
                            fontSize: 11,
                          }}
                        >
                          {worst} ({entry.warnings.length})
                        </Badge>
                      ) : (
                        <Typography variant="pi" textColor="success600">
                          ✓ clean
                        </Typography>
                      )}
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral400">
                        {entry.lastAnalyzedAt
                          ? new Date(entry.lastAnalyzedAt).toLocaleDateString()
                          : '—'}
                      </Typography>
                    </Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="S"
                        onClick={() => handleReanalyze(entry)}
                        loading={isReanalyzing}
                        startIcon={<Refresh />}
                      >
                        Re-analyze
                      </Button>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </Box>
      )}
    </Box>
  )
}

export default FreshnessDashboard
