/**
 * ContentPulse Plugin for Strapi v5
 *
 * Registers:
 *  1. Lifecycle hooks — auto-analyze on create/update
 *  2. Webhook notifier — fire when score drops below threshold
 *  3. Bulk cron scheduler — daily re-analysis of all monitored content
 *  4. REST API routes — /api/content-pulse/dashboard + /reanalyze
 *  5. Admin menu injection — Freshness Dashboard page
 */
import type { Core } from '@strapi/strapi'
import { analyzeContent } from './services/content-pulse'
import { notify } from './services/notifier'
import { registerCronTask } from './services/scheduler'

// ─── Plugin config shape ──────────────────────────────────────────────────────

interface ContentPulseConfig {
  collections?: string[]
  maxAgeDays?: number
  warningThreshold?: number
  webhookUrl?: string
  slackChannel?: string
  cron?: string
  batchSize?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConfig(strapi: Core.Strapi): ContentPulseConfig {
  return (strapi.config.get('plugin::content-pulse') ?? {}) as ContentPulseConfig
}

const TEXT_FIELDS = ['content', 'body', 'description', 'excerpt']

async function analyzeAndSave(
  strapi: Core.Strapi,
  result: Record<string, unknown>,
  config: ContentPulseConfig
) {
  if (result._isAnalyzing) return

  const contentToAnalyze = TEXT_FIELDS
    .map((f) => result[f])
    .find((v) => v !== undefined)

  if (!contentToAnalyze) return

  const analysis = analyzeContent(contentToAnalyze, config.maxAgeDays ?? 365)

  // Persist to the document
  try {
    await strapi.db.query((result.contentType as string) || '').update({
      where: { id: result.id },
      data: {
        _pulseScore: analysis.score,
        _pulseWarnings: JSON.stringify(analysis.warnings),
        _lastAnalyzedAt: analysis.analyzedAt,
      },
    })
  } catch {
    // Field might not be present — non-fatal
  }

  // Fire webhook if score is below threshold
  const threshold = config.warningThreshold ?? 80
  if (analysis.score < threshold && config.webhookUrl) {
    await notify(
      {
        documentId: result.id as string,
        contentType: (result.contentType as string) ?? '',
        score: analysis.score,
        warnings: analysis.warnings,
        analyzedAt: analysis.analyzedAt,
        strapiUrl: process.env.PUBLIC_URL,
      },
      {
        webhookUrl: config.webhookUrl,
        threshold,
        slackChannel: config.slackChannel,
      }
    )
  }
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    const config = getConfig(strapi)
    const monitored = config.collections ?? []

    if (!monitored.length) {
      strapi.log.warn(
        '[ContentPulse] No collections configured. Add `collections` in plugin config.'
      )
      return
    }

    // Lifecycle hooks — run on every monitored collection
    for (const uid of monitored) {
      strapi.db.lifecycles.subscribe({
        models: [uid],

        async afterCreate(event: { result: Record<string, unknown> }) {
          try {
            await analyzeAndSave(strapi, { ...event.result, contentType: uid }, config)
          } catch (err) {
            strapi.log.error('[ContentPulse] afterCreate analysis error:', err)
          }
        },

        async afterUpdate(event: { result: Record<string, unknown> }) {
          try {
            await analyzeAndSave(strapi, { ...event.result, contentType: uid }, config)
          } catch (err) {
            strapi.log.error('[ContentPulse] afterUpdate analysis error:', err)
          }
        },
      })
    }

    // REST API: GET /api/content-pulse/dashboard
    strapi.server.router.get('/api/content-pulse/dashboard', async (ctx) => {
      const entries: unknown[] = []

      for (const uid of monitored) {
        try {
          const docs = await strapi.db.query(uid).findMany({ limit: 1000 })
          for (const doc of docs) {
            const d = doc as Record<string, unknown>
            entries.push({
              id: d.id,
              documentId: d.documentId ?? d.id,
              contentType: uid,
              title: d.title ?? d.name ?? d.slug ?? null,
              score: d._pulseScore ?? 100,
              warnings: (() => {
                try { return JSON.parse((d._pulseWarnings as string) ?? '[]') } catch { return [] }
              })(),
              lastAnalyzedAt: d._lastAnalyzedAt ?? null,
            })
          }
        } catch {
          // Collection might not have pulse fields yet — skip
        }
      }

      ctx.body = { data: entries }
    })

    // REST API: POST /api/content-pulse/reanalyze/:uid/:documentId
    strapi.server.router.post(
      '/api/content-pulse/reanalyze/:uid/:documentId',
      async (ctx) => {
        const { uid, documentId } = ctx.params as Record<string, string>
        try {
          const doc = await strapi.db.query(decodeURIComponent(uid)).findOne({
            where: { documentId },
          }) as Record<string, unknown> | null

          if (!doc) {
            ctx.status = 404
            ctx.body = { error: 'Document not found' }
            return
          }

          await analyzeAndSave(
            strapi,
            { ...doc, contentType: decodeURIComponent(uid) },
            config
          )

          // Return updated pulse data
          const updated = await strapi.db.query(decodeURIComponent(uid)).findOne({
            where: { documentId },
          }) as Record<string, unknown>

          ctx.body = {
            data: {
              score: updated._pulseScore,
              warnings: (() => {
                try { return JSON.parse((updated._pulseWarnings as string) ?? '[]') } catch { return [] }
              })(),
              lastAnalyzedAt: updated._lastAnalyzedAt,
            },
          }
        } catch (err) {
          ctx.status = 500
          ctx.body = { error: (err as Error).message }
        }
      }
    )
  },

  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const config = getConfig(strapi)

    // Register cron task for bulk re-analysis
    registerCronTask(strapi, {
      cron: config.cron,
      collections: config.collections ?? [],
      maxAgeDays: config.maxAgeDays,
      batchSize: config.batchSize,
    })

    strapi.log.info(
      `[ContentPulse] Initialized. Monitoring: ${(config.collections ?? []).join(', ') || 'none'}`
    )
  },
}
