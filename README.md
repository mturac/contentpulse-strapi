# 🫀 ContentPulse — Strapi v5

**Semantic Decay & Freshness Engine for Strapi v5**

> Detect stale dates, outdated version references, and rotting content — before your readers do.

[![Strapi v5](https://img.shields.io/badge/Strapi-v5-4945FF?style=flat-square&logo=strapi)](https://strapi.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-mturac%2Fcontentpulse--strapi-181717?style=flat-square&logo=github)](https://github.com/mturac/contentpulse-strapi)

---

## The Problem

Your CMS has a freshness problem you don't know about yet.

A blog post from 2022 still says `"Node.js v14 is recommended."` A tutorial references an API deprecated last year. Docs say `"latest: 3.2.1"` — it's now `4.1.0`. Nobody catches it. Your readers do.

**ContentPulse fixes this.**

---

## What It Does

| Feature | Description |
|---|---|
| 🗓 **Date Decay** | Flags stale dates using `chrono-node` NLP parsing |
| 🔖 **Version Decay** | Detects outdated version strings (`v3.x`, `2022 edition`) |
| 📊 **Freshness Score** | 0–100 per document, severity-weighted |
| ⚡ **Lifecycle Hooks** | Auto-analyze on every create/update |
| 🔔 **Webhook Alerts** | Slack / Teams / custom HTTP when score drops below threshold |
| 🕐 **Cron Bulk Scan** | Daily re-analysis of all monitored content — no editor action needed |
| 🖥 **Freshness Dashboard** | Admin UI: all collections sorted by score, filter by severity, re-analyze on demand |
| 🔌 **REST API** | `/api/content-pulse/dashboard` + `/reanalyze/:uid/:id` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Strapi v5 Instance                        │
│                                                             │
│  ┌───────────────┐   save    ┌─────────────────────────┐   │
│  │  Content Type │ ────────► │  Lifecycle Hook         │   │
│  │  (article,    │           │  afterCreate / afterUpdate│  │
│  │   post, docs) │           └────────────┬────────────┘   │
│  └───────────────┘                        │                 │
│                                           ▼                 │
│                               ┌─────────────────────┐      │
│                               │  analyzeContent()   │      │
│                               │  ├─ Date Decay      │      │
│                               │  └─ Version Decay   │      │
│                               └────────────┬────────┘      │
│                                            │                │
│               ┌────────────────────────────┤                │
│               │            │               │                │
│               ▼            ▼               ▼                │
│      ┌──────────────┐ ┌─────────┐ ┌──────────────┐        │
│      │ DB: _pulse   │ │Webhook  │ │ Admin Panel  │        │
│      │ Score/Warn   │ │Notifier │ │ Dashboard    │        │
│      └──────────────┘ └─────────┘ └──────────────┘        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Cron Scheduler (daily 03:00)                        │  │
│  │  → Bulk scans ALL monitored docs in batches of 50    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Installation

```bash
# From npm (once published)
npm install strapi-plugin-content-pulse

# From source
cd your-strapi-project
npm install ../path/to/contentpulse-strapi
```

---

## Configuration

```ts
// config/plugins.ts
export default {
  'content-pulse': {
    enabled: true,
    config: {
      // Collections to monitor (required)
      collections: [
        'api::article.article',
        'api::post.post',
        'api::doc.doc',
      ],

      // Score floor — warn below this (default: 80)
      warningThreshold: 80,

      // Days before a date reference is considered stale (default: 365)
      maxAgeDays: 365,

      // Webhook URL for Slack / Teams / custom HTTP (optional)
      webhookUrl: process.env.CONTENT_PULSE_WEBHOOK_URL,

      // Optional Slack channel override (e.g. '#content-alerts')
      slackChannel: process.env.CONTENT_PULSE_SLACK_CHANNEL,

      // Cron expression for bulk re-analysis (default: daily at 03:00)
      cron: '0 3 * * *',

      // Documents per batch during bulk scan (default: 50)
      batchSize: 50,
    },
  },
}
```

---

## Webhook Notifications

When a document's freshness score drops below `warningThreshold`, ContentPulse fires a webhook.

**Slack** — auto-detected by URL, sends Block Kit cards:

```
┌─────────────────────────────────────────┐
│  🔴 ContentPulse Alert                  │
│                                         │
│  Content Type    Freshness Score        │
│  article         32/100                 │
│                                         │
│  Decay Warnings                         │
│  • [CRITICAL] Stale date: "Jan 2022"    │
│  • [HIGH] Outdated: "v3.2.1"            │
│                                         │
│  [Review in Strapi →]                   │
└─────────────────────────────────────────┘
```

**Generic HTTP** — sends structured JSON:

```json
{
  "event": "content_pulse.decay",
  "timestamp": "2026-05-28T03:00:00.000Z",
  "data": {
    "documentId": "abc123",
    "contentType": "api::article.article",
    "score": 32,
    "warnings": [
      {
        "type": "date_decay",
        "severity": "critical",
        "message": "Stale date: \"January 2022\" (1600 days ago)",
        "originalText": "January 2022",
        "suggestion": "Consider updating this reference."
      }
    ]
  }
}
```

---

## Bulk Cron Re-Analysis

Content written years ago won't re-analyze itself unless an editor saves it again. ContentPulse solves this with an optional daily cron scan.

```
[03:00 daily]
  → Scan api::article.article (batch 50)
  → Scan api::post.post (batch 50)
  → Update _pulseScore, _pulseWarnings, _lastAnalyzedAt
  → Log: "420 docs scanned, 37 flagged as stale"
```

Override the schedule:

```ts
cron: '0 */6 * * *'  // every 6 hours
cron: '0 9 * * 1'    // Monday mornings
```

---

## Freshness Dashboard

A full admin panel page listing all monitored documents by freshness score.

**Features:**
- Stats bar (total, avg score, fresh / stale / critical counts)
- Filter by severity (all / fresh / stale / critical)
- Sort by score ascending or descending
- Mini score bar per document
- Worst severity badge with warning count
- Per-row **Re-analyze** button (no page reload)

---

## REST API

### `GET /api/content-pulse/dashboard`

Returns freshness data for all monitored documents.

```json
{
  "data": [
    {
      "id": 1,
      "documentId": "abc123xyz789",
      "contentType": "api::article.article",
      "title": "Getting Started with Node.js",
      "score": 32,
      "warnings": [...],
      "lastAnalyzedAt": "2026-05-28T03:00:00.000Z"
    }
  ]
}
```

### `POST /api/content-pulse/reanalyze/:uid/:documentId`

Trigger a fresh analysis on a single document.

```bash
curl -X POST \
  /api/content-pulse/reanalyze/api::article.article/abc123xyz789
```

Response:

```json
{
  "data": {
    "score": 75,
    "warnings": [...],
    "lastAnalyzedAt": "2026-05-28T10:15:00.000Z"
  }
}
```

---

## Scoring System

| Severity | Deduction | Trigger |
|---|---|---|
| **Critical** | −25 pts | Date or version > 3 years old |
| **High** | −15 pts | Date or version > 2 years old |
| **Medium** | −10 pts | Date > 1.5 yrs old / version > 1 yr old |
| **Low** | −5 pts | Any detected stale pattern |

Score range: `0` (fully decayed) → `100` (completely fresh)

---

## Manual Analysis

```ts
// In any Strapi service or controller
const pulseService = strapi.plugin('content-pulse').service('contentPulse')

const result = pulseService.analyzeContent(document.body, 365)

console.log(result)
// {
//   score: 55,
//   warnings: [
//     {
//       type: 'date_decay',
//       severity: 'high',
//       message: 'Stale date: "March 2024" (450 days ago)',
//       originalText: 'March 2024',
//       suggestion: 'Consider updating this reference.'
//     }
//   ],
//   analyzedAt: '2026-05-28T10:00:00.000Z'
// }
```

---

## Project Structure

```
src/
├── index.ts                          # Plugin entry, lifecycle hooks, REST routes
├── services/
│   ├── content-pulse.ts              # Core analyzer (chrono-node + regex)
│   ├── notifier.ts                   # Webhook / Slack notifications
│   └── scheduler.ts                  # Bulk cron re-analysis
└── admin/src/
    ├── components/
    │   └── PulseWidget.tsx           # Per-document sidebar widget
    └── pages/
        └── FreshnessDashboard/
            └── index.tsx             # Full admin dashboard page
```

---

## Roadmap

- [ ] Broken link detection (`url_rot` warning type)
- [ ] Custom decay rules (user-defined regex patterns)
- [ ] Locale-aware analysis for multilingual setups
- [ ] npm package publish
- [ ] CSV/JSON export for auditing

---

## License

MIT © [Mehmet Turac](https://github.com/mturac)
