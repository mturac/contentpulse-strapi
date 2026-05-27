/**
 * PulseWidget - Strapi Admin Panel Component
 * Displays content freshness score and warnings
 */
import React, { useEffect, useState } from 'react'
import { Box, Typography, Flex, Badge } from '@strapi/design-system'

interface PulseWarning {
  type: string
  severity: string
  message: string
  suggestion?: string
}

interface PulseData {
  score: number
  warnings: PulseWarning[]
  lastAnalyzedAt: string | null
}

const severityColors: Record<string, string> = {
  critical: '#ff4444',
  high: '#ff8844',
  medium: '#ffcc44',
  low: '#44cc66',
}

const getScoreColor = (score: number): string => {
  if (score >= 80) return '#4ade80'
  if (score >= 60) return '#fbbf24'
  if (score >= 40) return '#fb923c'
  return '#ef4444'
}

export const PulseWidget: React.FC = () => {
  const [data, setData] = useState<PulseData | null>(null)

  useEffect(() => {
    // Read from Strapi admin state
    const readData = () => {
      try {
        const meta = (window as any).__STRAPI_DATA__?.meta
        if (meta?._pulseScore !== undefined) {
          setData({
            score: meta._pulseScore,
            warnings: JSON.parse(meta._pulseWarnings || '[]'),
            lastAnalyzedAt: meta._lastAnalyzedAt,
          })
        }
      } catch {}
    }

    readData()
    const interval = setInterval(readData, 2000)
    return () => clearInterval(interval)
  }, [])

  if (!data) {
    return (
      <Box padding={4} background="neutral100" borderRadius="8px">
        <Typography variant="sigma" textColor="neutral600">
          CONTENT PULSE
        </Typography>
        <Typography variant="pi" textColor="neutral500" marginTop={2}>
          Save document to analyze freshness
        </Typography>
      </Box>
    )
  }

  return (
    <Box padding={4} background="neutral100" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Typography variant="sigma" textColor="neutral600">
          CONTENT PULSE
        </Typography>
        <Typography
          variant="alpha"
          textColor={getScoreColor(data.score)}
          style={{ fontWeight: 700 }}
        >
          {data.score}
        </Typography>
      </Flex>

      {/* Progress bar */}
      <Box
        background="neutral200"
        height="6px"
        borderRadius="3px"
        marginBottom={3}
        overflow="hidden"
      >
        <Box
          background={getScoreColor(data.score)}
          height="100%"
          width={`${data.score}%`}
          borderRadius="3px"
          style={{ transition: 'width 0.3s ease' }}
        />
      </Box>

      {/* Warnings */}
      {data.warnings.length > 0 ? (
        <Flex direction="column" gap={2}>
          {data.warnings.map((warning, i) => (
            <Box
              key={i}
              padding={2}
              background="neutral0"
              borderRadius="4px"
              borderLeft={`3px solid ${severityColors[warning.severity] || '#888'}`}
            >
              <Flex gap={2} alignItems="center" marginBottom={1}>
                <Badge
                  backgroundColor={severityColors[warning.severity]}
                  textColor="neutral0"
                >
                  {warning.severity}
                </Badge>
                <Typography variant="pi" textColor="neutral500">
                  {warning.type.replace('_', ' ')}
                </Typography>
              </Flex>
              <Typography variant="omega" textColor="neutral800">
                {warning.message}
              </Typography>
            </Box>
          ))}
        </Flex>
      ) : (
        <Typography variant="pi" textColor="success600" textAlign="center">
          ✓ Content is fresh
        </Typography>
      )}

      {data.lastAnalyzedAt && (
        <Typography
          variant="pi"
          textColor="neutral400"
          marginTop={3}
          textAlign="center"
          display="block"
        >
          Last analyzed: {new Date(data.lastAnalyzedAt).toLocaleString()}
        </Typography>
      )}
    </Box>
  )
}
