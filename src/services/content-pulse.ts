/**
 * ContentPulse Service for Strapi v5
 * Content freshness analysis service
 */
import * as chrono from 'chrono-node'

interface PulseWarning {
  type: 'date_decay' | 'version_decay'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  originalText: string
  suggestion?: string
}

interface PulseAnalysisResult {
  score: number
  warnings: PulseWarning[]
  analyzedAt: string
}

const DEFAULT_VERSION_PATTERNS = [
  /\b(?:v(?:ersion)?\s*)?(\d+)\.(\d+)\.(\d+)\b/gi,
  /\b(20[12]\d)\s+(?:edition|version|release|update)\b/gi,
]

/**
 * Extract text from Strapi rich text (blocks or markdown)
 */
function extractText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content.map(extractText).join(' ')
  }

  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>
    const parts: string[] = []

    // Strapi blocks format
    if (obj.type === 'text' && typeof obj.text === 'string') {
      parts.push(obj.text)
    }

    // Paragraph/list items
    if (Array.isArray(obj.children)) {
      parts.push(extractText(obj.children))
    }

    return parts.filter(Boolean).join(' ')
  }

  return ''
}

/**
 * Analyze content for semantic decay
 */
export function analyzeContent(
  content: unknown,
  maxAgeDays: number = 365
): PulseAnalysisResult {
  const text = extractText(content)
  const now = new Date()
  const warnings: PulseWarning[] = []

  if (!text.trim()) {
    return { score: 100, warnings: [], analyzedAt: now.toISOString() }
  }

  // Date decay detection
  const parsedDates = chrono.parse(text, now)
  for (const dateResult of parsedDates) {
    const parsedDate = dateResult.start.date()
    if (parsedDate > now) continue

    const ageDays = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24))

    if (ageDays > maxAgeDays) {
      let severity: PulseWarning['severity'] = 'low'
      if (ageDays > maxAgeDays * 3) severity = 'critical'
      else if (ageDays > maxAgeDays * 2) severity = 'high'
      else if (ageDays > maxAgeDays * 1.5) severity = 'medium'

      warnings.push({
        type: 'date_decay',
        severity,
        message: `Stale date: "${dateResult.text}" (${ageDays} days ago)`,
        originalText: dateResult.text,
        suggestion: `Consider updating this reference.`,
      })
    }
  }

  // Version decay detection
  for (const pattern of DEFAULT_VERSION_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const yearMatch = match[0].match(/\b(20[12]\d)\b/)
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10)
        const yearDiff = now.getFullYear() - year
        if (yearDiff >= 1) {
          let severity: PulseWarning['severity'] = 'low'
          if (yearDiff >= 3) severity = 'critical'
          else if (yearDiff >= 2) severity = 'high'
          else if (yearDiff >= 1) severity = 'medium'

          warnings.push({
            type: 'version_decay',
            severity,
            message: `Outdated version: "${match[0]}" (${yearDiff} year(s) old)`,
            originalText: match[0],
          })
        }
      }
    }
  }

  // Calculate score
  let score = 100
  for (const w of warnings) {
    if (w.severity === 'critical') score -= 25
    else if (w.severity === 'high') score -= 15
    else if (w.severity === 'medium') score -= 10
    else score -= 5
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    warnings,
    analyzedAt: now.toISOString(),
  }
}

export default () => ({
  analyzeContent,
})
