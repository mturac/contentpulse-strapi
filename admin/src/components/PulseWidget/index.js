'use strict';

/**
 * PulseWidget - Strapi Admin Panel Widget
 * Displays content freshness score and decay warnings
 */

import React, { useEffect, useState } from 'react';

// Severity color mapping (Strapi design system compatible)
const severityColors = {
  critical: { bg: '#fce4ec', text: '#c62828', badge: '#d32f2f' },
  high: { bg: '#fff3e0', text: '#e65100', badge: '#f57c00' },
  medium: { bg: '#fff8e1', text: '#f9a825', badge: '#fbc02d' },
  low: { bg: '#e8f5e9', text: '#2e7d32', badge: '#4caf50' },
};

// Warning type icons
const typeIcons = {
  date_decay: '📅',
  version_decay: '🔖',
  custom: '⚡',
};

/**
 * Get color based on score value (Strapi design system)
 */
function getScoreColor(score) {
  if (score >= 80) return '#4caf50'; // Green
  if (score >= 60) return '#ff9800'; // Orange
  if (score >= 40) return '#f57c00'; // Dark Orange
  return '#d32f2f'; // Red
}

/**
 * Get status text based on score
 */
function getStatusText(score) {
  if (score >= 90) return 'Excellent - Content is fresh';
  if (score >= 80) return 'Good - Content is mostly current';
  if (score >= 60) return 'Fair - Some updates needed';
  if (score >= 40) return 'Poor - Significant updates required';
  return 'Critical - Content is severely outdated';
}

/**
 * Warning card component
 */
function WarningCard({ warning }) {
  const [expanded, setExpanded] = useState(false);
  const colors = severityColors[warning.severity] || severityColors.low;

  return (
    <div
      style={{
        padding: '12px',
        marginBottom: '8px',
        borderRadius: '4px',
        backgroundColor: colors.bg,
        border: `1px solid ${colors.text}40`,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span>{typeIcons[warning.type] || '⚠️'}</span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: colors.badge,
            color: '#fff',
            textTransform: 'uppercase',
          }}
        >
          {warning.severity}
        </span>
        <span style={{ fontSize: '12px', color: '#666' }}>
          {warning.type.replace('_', ' ')}
        </span>
      </div>
      <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.4' }}>
        {warning.message}
      </div>
      {expanded && warning.suggestion && (
        <div
          style={{
            fontSize: '12px',
            color: '#666',
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: `1px solid ${colors.text}20`,
            fontStyle: 'italic',
          }}
        >
          💡 {warning.suggestion}
        </div>
      )}
    </div>
  );
}

/**
 * Main PulseWidget component
 * Can be used as a sidebar widget or injected into edit view
 */
export function PulseWidget({ documentId, collectionName }) {
  const [score, setScore] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [lastAnalyzed, setLastAnalyzed] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch pulse data from API
  useEffect(() => {
    if (!documentId || !collectionName) {
      setLoading(false);
      return;
    }

    const fetchPulseData = async () => {
      try {
        const response = await fetch(
          `/api/content-pulse/${collectionName}/${documentId}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setScore(data._pulseScore ?? 100);
          setWarnings(data._pulseWarnings ?? []);
          setLastAnalyzed(data._lastAnalyzedAt);
        }
      } catch (error) {
        console.error('Failed to fetch pulse data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPulseData();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchPulseData, 3000);
    return () => clearInterval(interval);
  }, [documentId, collectionName]);

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          color: '#666',
          fontSize: '13px',
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
        <div>Analyzing content freshness...</div>
      </div>
    );
  }

  // No data state
  if (score === null) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          color: '#666',
          fontSize: '13px',
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>📊</div>
        <div>Save document to analyze content</div>
      </div>
    );
  }

  const scoreColor = getScoreColor(score);
  const statusText = getStatusText(score);

  return (
    <div
      style={{
        padding: '16px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <h3
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#333',
            margin: 0,
          }}
        >
          Content Pulse
        </h3>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: scoreColor,
              lineHeight: 1,
            }}
          >
            {score}
          </span>
          <span style={{ fontSize: '12px', color: '#999' }}>/ 100</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          height: '8px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px',
          overflow: 'hidden',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${score}%`,
            backgroundColor: scoreColor,
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Status */}
      <div
        style={{
          fontSize: '13px',
          color: '#666',
          marginBottom: '16px',
        }}
      >
        {statusText}
      </div>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <div>
          {warnings.map((warning, index) => (
            <WarningCard key={`${warning.type}-${index}`} warning={warning} />
          ))}
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '16px',
            color: '#999',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '4px' }}>✨</div>
          <div style={{ fontSize: '13px' }}>No decay detected</div>
        </div>
      )}

      {/* Last Analyzed */}
      {lastAnalyzed && (
        <div
          style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid #f0f0f0',
            fontSize: '11px',
            color: '#999',
            textAlign: 'center',
          }}
        >
          Last analyzed: {new Date(lastAnalyzed).toLocaleString()}
        </div>
      )}
    </div>
  );
}

export default PulseWidget;
