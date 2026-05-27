# ContentPulse Strapi Plugin

Content freshness analysis and semantic decay detection for Strapi v4/v5.

## Features

- **Date Decay Detection**: Identifies stale dates using chrono-node natural language parsing
- **Version String Decay**: Detects outdated version references (v2.0.0, 2023 edition)
- **Freshness Scoring**: 0-100 score with severity-weighted deductions
- **Lifecycle Hooks**: Automatic analysis on content create/update
- **Admin Widget**: Visual dashboard with color-coded warnings

## Installation

```bash
cd your-strapi-project
npm install ../path/to/strapi-plugin
```

Or copy the `strapi-plugin` folder into your Strapi project's `src/plugins/` directory.

## Configuration

Add to `config/plugins.js` (Strapi v4) or `config/plugins.ts` (Strapi v5):

```js
// config/plugins.js
module.exports = {
  contentpulse: {
    enabled: true,
    config: {
      // Collections to monitor
      collections: ['api::article.article', 'api::post.post'],

      // Minimum score before warnings (default: 80)
      warningThreshold: 80,

      // Maximum age in days before date is stale (default: 365)
      maxAgeDays: 365,

      // Enable/disable analyzers
      analyzers: {
        dates: true,
        versions: true,
      },

      // Custom version patterns (regex strings)
      customVersionPatterns: [
        '\\bAPI\\s+v\\d+\\b',
      ],
    },
  },
};
```

## Usage

### Automatic Analysis

After configuration, the plugin automatically:

1. Adds `_pulseScore`, `_pulseWarnings`, and `_lastAnalyzedAt` fields to monitored collections
2. Runs analysis after every create/update operation
3. Updates the document with freshness data

### Manual Analysis

```js
// In a custom controller or service
const pulseService = strapi.service('plugin::contentpulse.content-pulse');

const result = await pulseService.analyzeContent({
  content: document.body,
  config: {
    maxAgeDays: 365,
    analyzers: { dates: true, versions: true },
  },
});

console.log(result);
// {
//   score: 85,
//   warnings: [
//     {
//       type: 'date_decay',
//       severity: 'medium',
//       message: 'Stale date detected: "January 2023" (450 days ago)',
//       originalText: 'January 2023',
//       suggestion: 'This date is 450 days old. Verify it's still current.'
//     }
//   ],
//   analyzedAt: '2024-01-15T10:30:00.000Z'
// }
```

### Admin Widget

To add the widget to your admin panel, create a custom field or inject it into the edit view:

```js
// src/admin/app.js or src/admin/app.tsx
import { PulseWidget } from 'contentpulse-strapi/admin/src/components/PulseWidget';

// Add to your custom edit view or use as a sidebar widget
```

## Scoring System

| Severity | Score Deduction | Trigger Condition |
|----------|----------------|-------------------|
| Critical | -25 | Dates > 3 years old, Versions > 3 years old |
| High | -15 | Dates > 2 years old, Versions > 2 years old |
| Medium | -10 | Dates > 1.5 years old, Versions > 1 year old |
| Low | -5 | Any detected version string |

## API Endpoints

The plugin exposes a REST API for fetching pulse data:

```
GET /api/content-pulse/:collection/:id
```

Response:
```json
{
  "_pulseScore": 85,
  "_pulseWarnings": [...],
  "_lastAnalyzedAt": "2024-01-15T10:30:00.000Z"
}
```

## Development

```bash
# Install dependencies
cd strapi-plugin
npm install

# Link to Strapi project
cd your-strapi-project
npm link ../strapi-plugin

# Run Strapi with plugin
npm run develop
```

## License

MIT
