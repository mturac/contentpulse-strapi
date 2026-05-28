/**
 * ContentPulse Scheduler Service
 *
 * Periodically re-analyzes all monitored content collections so that
 * documents written long ago don't silently accumulate decay without
 * ever being re-saved by an editor.
 *
 * Schedule is configured via plugin config:
 *   cron: '0 3 * * *'  (default: daily at 03:00)
 *
 * The scheduler processes documents in batches to avoid overwhelming
 * the database on large catalogs.
 */
import type { Core } from '@strapi/strapi'
import { analyzeContent } from './content-pulse'

export interface SchedulerConfig {
  cron?: string              // cron expression (default: '0 3 * * *')
  collections?: string[]     // UIDs to scan (required)
  maxAgeDays?: number        // passed through to analyzer
  batchSize?: number         // documents per batch (default: 50)
  webhookThreshold?: number  // if set, fires notifier for docs below this score
}

const DEFAULT_CRON = '0 3 * * *'
const DEFAULT_BATCH = 50

/**
 * Register a cron task that bulk-scans all monitored collections.
 * Called from plugin bootstrap().
 */
export function registerCronTask(strapi: Core.Strapi, config: SchedulerConfig): void {
  const { cron = DEFAULT_CRON, collections = [], maxAgeDays = 365, batchSize = DEFAULT_BATCH } =
    config

  if (!collections.length) {
    strapi.log.warn('[ContentPulse] Scheduler: no collections configured — skipping cron setup.')
    return
  }

  strapi.cron.add({
    'content-pulse-bulk-scan': {
      task: async () => {
        strapi.log.info('[ContentPulse] Starting bulk freshness scan…')
        let total = 0
        let stale = 0

        for (const uid of collections) {
          try {
            const count = await scanCollection(strapi, uid, { maxAgeDays, batchSize })
            total += count.total
            stale += count.stale
          } catch (err) {
            strapi.log.error(`[ContentPulse] Failed to scan ${uid}:`, err)
          }
        }

        strapi.log.info(
          `[ContentPulse] Bulk scan complete — ${total} docs scanned, ${stale} flagged as stale.`
        )
      },
      options: { rule: cron },
    },
  })

  strapi.log.info(`[ContentPulse] Bulk scan scheduled: "${cron}"`)
}

/**
 * Scan a single collection in batches.
 * Returns counts of total documents scanned and stale ones found.
 */
async function scanCollection(
  strapi: Core.Strapi,
  uid: string,
  opts: { maxAgeDays: number; batchSize: number }
): Promise<{ total: number; stale: number }> {
  const { maxAgeDays, batchSize } = opts
  const textFields = ['content', 'body', 'description', 'excerpt']

  let page = 1
  let total = 0
  let stale = 0
  let hasMore = true

  while (hasMore) {
    // Use raw DB query for speed — we don't need full Document Service overhead here
    const docs = await strapi.db.query(uid).findMany({
      limit: batchSize,
      offset: (page - 1) * batchSize,
    })

    if (!docs.length) {
      hasMore = false
      break
    }

    for (const doc of docs) {
      const contentToAnalyze = textFields.map((f) => (doc as Record<string, unknown>)[f]).find(Boolean)

      if (!contentToAnalyze) continue

      const result = analyzeContent(contentToAnalyze, maxAgeDays)
      total++

      if (result.score < 100) stale++

      // Persist updated pulse data directly via DB (bypasses lifecycle to avoid re-triggering)
      try {
        await strapi.db.query(uid).update({
          where: { id: (doc as Record<string, unknown>).id },
          data: {
            _pulseScore: result.score,
            _pulseWarnings: JSON.stringify(result.warnings),
            _lastAnalyzedAt: result.analyzedAt,
          },
        })
      } catch {
        // Field might not exist on this collection — skip silently
      }
    }

    page++

    // Yield between batches to avoid blocking the event loop
    if (hasMore) await new Promise((r) => setTimeout(r, 50))
  }

  return { total, stale }
}

export default () => ({ registerCronTask })
