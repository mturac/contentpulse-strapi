/**
 * ContentPulse Notifier Service
 *
 * Sends webhook notifications when content freshness drops below threshold.
 * Supports any HTTP webhook endpoint (Slack, Discord, Teams, custom).
 */

export interface NotifierConfig {
  webhookUrl?: string
  threshold?: number          // score floor before firing (default: 80)
  slackChannel?: string       // optional: Slack channel override
}

export interface NotifyPayload {
  documentId: string | number
  contentType: string
  score: number
  warnings: Array<{
    type: string
    severity: string
    message: string
    originalText: string
    suggestion?: string
  }>
  analyzedAt: string
  strapiUrl?: string
}

function buildSlackBlocks(payload: NotifyPayload, strapiUrl?: string) {
  const scoreEmoji =
    payload.score >= 80 ? '🟢' : payload.score >= 60 ? '🟡' : payload.score >= 40 ? '🟠' : '🔴'

  const warningLines = payload.warnings
    .slice(0, 5)
    .map((w) => `• *[${w.severity.toUpperCase()}]* ${w.message}`)
    .join('\n')

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${scoreEmoji} ContentPulse Alert` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Content Type*\n${payload.contentType}` },
        { type: 'mrkdwn', text: `*Freshness Score*\n${payload.score}/100` },
      ],
    },
  ]

  if (warningLines) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Decay Warnings*\n${warningLines}` },
    })
  }

  if (strapiUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Review in Strapi' },
          url: `${strapiUrl}/admin/content-manager/${payload.contentType}/${payload.documentId}`,
          style: 'primary',
        },
      ],
    })
  }

  return blocks
}

/**
 * Send a freshness decay notification to the configured webhook.
 *
 * Auto-detects Slack webhook format (api.slack.com) and sends
 * Block Kit payload. Falls back to generic JSON for all other endpoints.
 */
export async function notify(payload: NotifyPayload, config: NotifierConfig): Promise<void> {
  const { webhookUrl, strapiUrl } = config

  if (!webhookUrl) return

  const isSlack = webhookUrl.includes('hooks.slack.com') || webhookUrl.includes('api.slack.com')

  const body = isSlack
    ? JSON.stringify({
        text: `ContentPulse: *${payload.contentType}* freshness score dropped to ${payload.score}/100`,
        blocks: buildSlackBlocks(payload, strapiUrl),
        channel: config.slackChannel,
      })
    : JSON.stringify({
        event: 'content_pulse.decay',
        timestamp: new Date().toISOString(),
        data: payload,
      })

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!res.ok) {
      throw new Error(`Webhook responded ${res.status}: ${await res.text()}`)
    }
  } catch (err) {
    // Log but don't throw — notification failure must never break content saves
    console.error('[ContentPulse] Webhook notification failed:', err)
  }
}

export default () => ({ notify })
