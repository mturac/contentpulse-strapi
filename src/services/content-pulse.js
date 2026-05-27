'use strict';

/**
 * ContentPulse Analyzer Service
 * Detects semantic decay in Strapi content
 */

const chrono = require('chrono-node');

// Default config values
const DEFAULT_WARNING_THRESHOLD = 80;
const DEFAULT_MAX_AGE_DAYS = 365;
const DEFAULT_VERSION_PATTERNS = [
  // Version X.Y.Z patterns (e.g., "v2.0.0", "version 1.5.3")
  /\b(?:v(?:ersion)?\s*)?(\d+)\.(\d+)\.(\d+)\b/gi,
  // Year-based versions (e.g., "2023 edition", "2024 version")
  /\b(20[12]\d)\s+(?:edition|version|release|update)\b/gi,
];

/**
 * Extract plain text from Strapi rich text (blocks) content recursively
 * Handles both Strapi v4 (WYSIWYG) and v5 (blocks) formats
 */
function extractTextFromRichText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.map(extractTextFromRichText).join(' ');
  }

  if (typeof content === 'object' && content !== null) {
    const parts = [];

    // Strapi v5 blocks format
    if (content.type === 'text' && typeof content.text === 'string') {
      parts.push(content.text);
    }

    // Strapi v4 WYSIWYG format (rich text HTML)
    if (typeof content === 'string') {
      // Strip HTML tags for plain text extraction
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Recurse into children (blocks format)
    if (Array.isArray(content.children)) {
      parts.push(extractTextFromRichText(content.children));
    }

    // Recurse into root (blocks format)
    if (content.root && typeof content.root === 'object') {
      parts.push(extractTextFromRichText(content.root));
    }

    // Recurse into nodes array
    if (Array.isArray(content.nodes)) {
      parts.push(extractTextFromRichText(content.nodes));
    }

    // Recurse into content array (some Strapi formats)
    if (Array.isArray(content.content)) {
      parts.push(extractTextFromRichText(content.content));
    }

    return parts.filter(Boolean).join(' ');
  }

  return '';
}

/**
 * Detect date-based decay warnings
 */
function detectDateDecay(text, maxAgeDays, now) {
  const warnings = [];
  const parsedDates = chrono.parse(text, now);

  for (const dateResult of parsedDates) {
    const dateText = dateResult.text;
    const parsedDate = dateResult.start.date();

    // Skip future dates
    if (parsedDate > now) continue;

    const ageMs = now.getTime() - parsedDate.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > maxAgeDays) {
      const ageYears = Math.floor(ageDays / 365);
      let severity = 'low';
      let suggestion = `This date is ${ageDays} days old.`;

      if (ageDays > maxAgeDays * 3) {
        severity = 'critical';
        suggestion = `This date is ${ageYears}+ years old and likely outdated. Consider updating.`;
      } else if (ageDays > maxAgeDays * 2) {
        severity = 'high';
        suggestion = `This date is over ${ageYears} year(s) old. Review for accuracy.`;
      } else if (ageDays > maxAgeDays * 1.5) {
        severity = 'medium';
        suggestion = `This date is ${ageDays} days old. Verify it's still current.`;
      }

      warnings.push({
        type: 'date_decay',
        severity,
        message: `Stale date detected: "${dateText}" (${ageDays} days ago)`,
        originalText: dateText,
        suggestion,
      });
    }
  }

  return warnings;
}

/**
 * Detect version string decay warnings
 */
function detectVersionDecay(text, patterns) {
  const warnings = [];

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const matchedText = match[0];

      // For year-based versions, check if the year is old
      const yearMatch = matchedText.match(/\b(20[12]\d)\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const currentYear = new Date().getFullYear();
        const yearDiff = currentYear - year;

        if (yearDiff >= 1) {
          let severity = 'low';
          if (yearDiff >= 3) severity = 'critical';
          else if (yearDiff >= 2) severity = 'high';
          else if (yearDiff >= 1) severity = 'medium';

          warnings.push({
            type: 'version_decay',
            severity,
            message: `Outdated version reference: "${matchedText}" (${yearDiff} year(s) old)`,
            originalText: matchedText,
            suggestion: 'Consider updating to the current year/version.',
          });
        }
      } else {
        // Generic version string found - flag as potential decay
        warnings.push({
          type: 'version_decay',
          severity: 'low',
          message: `Version reference detected: "${matchedText}" - verify it's current`,
          originalText: matchedText,
          suggestion: 'Check if this version is still supported or current.',
        });
      }
    }
  }

  return warnings;
}

/**
 * Calculate freshness score from warnings
 * Scoring: critical=-25, high=-15, medium=-10, low=-5
 */
function calculateScore(warnings) {
  let score = 100;

  for (const warning of warnings) {
    switch (warning.severity) {
      case 'critical':
        score -= 25;
        break;
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 10;
        break;
      case 'low':
        score -= 5;
        break;
    }
  }

  // Clamp score to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Analyze content for semantic decay
 *
 * @param {Object} options
 * @param {unknown} options.content - The content to analyze (rich text, blocks, or plain text)
 * @param {Object} options.config - Plugin configuration
 * @returns {Promise<{score: number, warnings: Array, analyzedAt: string}>}
 */
async function analyzeContent({ content, config = {} }) {
  const maxAgeDays = config.maxAgeDays || DEFAULT_MAX_AGE_DAYS;
  const analyzers = config.analyzers || { dates: true, versions: true };

  // Extract plain text from rich text content
  const text = extractTextFromRichText(content);

  if (!text.trim()) {
    return {
      score: 100,
      warnings: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  const now = new Date();
  const warnings = [];

  // Run date decay detection
  if (analyzers.dates !== false) {
    warnings.push(...detectDateDecay(text, maxAgeDays, now));
  }

  // Run version decay detection
  if (analyzers.versions !== false) {
    const patterns = [
      ...DEFAULT_VERSION_PATTERNS,
      ...(config.customVersionPatterns || []).map(p => new RegExp(p, 'gi')),
    ];
    warnings.push(...detectVersionDecay(text, patterns));
  }

  // Calculate freshness score
  const score = calculateScore(warnings);

  return {
    score,
    warnings,
    analyzedAt: now.toISOString(),
  };
}

module.exports = {
  analyzeContent,
  extractTextFromRichText,
  detectDateDecay,
  detectVersionDecay,
  calculateScore,
};
