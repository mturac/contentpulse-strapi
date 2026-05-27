/**
 * ContentPulse Plugin for Strapi v5
 * Registers lifecycle hooks for content freshness analysis
 */
import type { Core } from '@strapi/strapi'

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Register afterCreate lifecycle hook
    strapi.db.lifecycles.subscribe({
      models: ['plugin::content-pulse.monitored'],

      async afterCreate(event: { result: Record<string, unknown> }) {
        await analyzeAndSave(strapi, event.result)
      },

      async afterUpdate(event: { result: Record<string, unknown> }) {
        await analyzeAndSave(strapi, event.result)
      },
    })
  },

  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    strapi.log.info('ContentPulse plugin initialized')
  },
}

async function analyzeAndSave(strapi: Core.Strapi, result: Record<string, unknown>) {
  const { analyzeContent } = strapi.plugin('content-pulse').service('contentPulse')

  const textFields = ['content', 'body', 'description', 'excerpt']
  const contentToAnalyze = textFields
    .map((field) => result[field])
    .find((value) => value !== undefined)

  if (!contentToAnalyze || result._isAnalyzing) return

  try {
    const analysis = analyzeContent(contentToAnalyze)

    await strapi.db.query(result.contentType || '').update({
      where: { id: result.id },
      data: {
        _pulseScore: analysis.score,
        _pulseWarnings: JSON.stringify(analysis.warnings),
        _lastAnalyzedAt: analysis.analyzedAt,
        _isAnalyzing: true,
      },
    })

    // Clear analyzing flag
    await strapi.db.query(result.contentType || '').update({
      where: { id: result.id },
      data: { _isAnalyzing: false },
    })
  } catch (error) {
    strapi.log.error('ContentPulse analysis error:', error)
  }
}
