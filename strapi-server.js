'use strict';

/**
 * ContentPulse Strapi Plugin - Main Entry
 * Strapi v4/v5 Plugin for Semantic Decay & Freshness Analysis
 */

const contentPulseService = require('./src/services/content-pulse');
const lifecycleService = require('./src/services/lifecycle');

/**
 * Extend monitored content types with pulse fields at bootstrap time.
 * Must run in bootstrap (not register) so content types are loaded.
 */
function extendContentTypes(strapi) {
  const config = strapi.config.get('plugin::content-pulse', {});
  const collections = config.collections || [];

  collections.forEach(collectionName => {
    const uid = `api::${collectionName}.${collectionName}`;
    const contentType = strapi.contentTypes[uid];
    if (!contentType) {
      strapi.log.warn(`ContentPulse: Collection "${collectionName}" not found (tried ${uid})`);
      return;
    }

    Object.assign(contentType.attributes, {
      _pulseScore: { type: 'integer', configurable: false, writable: true, visible: false, default: 100, columnName: '_pulse_score' },
      _pulseWarnings: { type: 'json', configurable: false, writable: true, visible: false, default: '[]', columnName: '_pulse_warnings' },
      _lastAnalyzedAt: { type: 'datetime', configurable: false, writable: true, visible: false, columnName: '_last_analyzed_at' },
    });
  });
}

module.exports = {
  register({ strapi }) {
    strapi.service('plugin::content-pulse.content-pulse', contentPulseService);
    strapi.service('plugin::content-pulse.lifecycle', lifecycleService);
  },

  bootstrap({ strapi }) {
    extendContentTypes(strapi);

    const config = strapi.config.get('plugin::content-pulse', {});
    const collections = config.collections || [];

    if (collections.length > 0) {
      lifecycleService.registerHooks({ strapi, collections, config });
      strapi.log.info(`ContentPulse: Monitoring collections [${collections.join(', ')}]`);
    } else {
      strapi.log.warn('ContentPulse: No collections configured.');
    }

    // ── REST routes ────────────────────────────────────────────────────────
    const router = strapi.server.router;

    // GET /content-pulse/dashboard
    router.get('/content-pulse/dashboard', async (ctx) => {
      const pluginConfig = strapi.config.get('plugin::content-pulse', {});
      const pluginCollections = pluginConfig.collections || [];
      const entries = [];

      for (const collectionName of pluginCollections) {
        const uid = `api::${collectionName}.${collectionName}`;
        try {
          const tableName = `${collectionName}s`; // article → articles
          const rows = await strapi.db.connection(tableName)
            .select('document_id', 'title', 'slug', '_pulse_score', '_pulse_warnings', '_last_analyzed_at')
            .whereNull('published_at') // drafts only
            .limit(200);
          for (const row of rows) {
            let warnings = [];
            try { warnings = JSON.parse(row._pulse_warnings || '[]'); } catch (_) {}
            entries.push({
              documentId: row.document_id,
              contentType: uid,
              title: row.title || row.slug || row.document_id,
              score: row._pulse_score ?? 100,
              warnings,
              lastAnalyzedAt: row._last_analyzed_at || null,
            });
          }
        } catch (err) {
          strapi.log.warn(`ContentPulse dashboard: error fetching ${uid}: ${err.message}`);
        }
      }
      ctx.body = { data: entries };
    });

    // POST /content-pulse/reanalyze/:uid/:documentId
    router.post('/content-pulse/reanalyze/:uid/:documentId', async (ctx) => {
      const { uid: rawUid, documentId } = ctx.params;
      const uid = decodeURIComponent(rawUid);
      const pluginConfig = strapi.config.get('plugin::content-pulse', {});

      try {
        const doc = await strapi.documents(uid).findOne({ documentId, status: 'draft' });
        if (!doc) { ctx.status = 404; ctx.body = { error: 'Document not found' }; return; }

        const texts = Object.entries(doc)
          .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.length > 10)
          .map(([k, v]) => ({ field: k, text: v }));

        const result = await contentPulseService.analyzeContent({
          content: texts.map(t => t.text).join('\n\n'),
          config: pluginConfig,
        });

        // Use raw knex — Document Service ignores runtime-extended fields
        const tableName = uid.split('::')[1].split('.')[0] + 's'; // api::article.article → articles
        await strapi.db.connection(tableName)
          .where({ document_id: documentId })
          .update({
            _pulse_score: result.score,
            _pulse_warnings: JSON.stringify(result.warnings),
            _last_analyzed_at: result.analyzedAt,
          });

        ctx.body = {
          data: {
            score: result.score,
            warnings: result.warnings,
            lastAnalyzedAt: result.analyzedAt,
          },
        };
      } catch (err) {
        strapi.log.error(`ContentPulse reanalyze error: ${err.message}`);
        ctx.status = 500;
        ctx.body = { error: err.message };
      }
    });

    // GET /content-pulse/export?format=csv|json
    router.get('/content-pulse/export', async (ctx) => {
      const format = ctx.query.format === 'csv' ? 'csv' : 'json';
      const pluginConfig = strapi.config.get('plugin::content-pulse', {});
      const pluginCollections = pluginConfig.collections || [];
      const entries = [];

      for (const collectionName of pluginCollections) {
        const uid = `api::${collectionName}.${collectionName}`;
        try {
          const docs = await strapi.documents(uid).findMany({ status: 'draft', limit: 1000 });
          for (const doc of docs) {
            entries.push({
              documentId: doc.documentId,
              contentType: uid,
              title: doc.title || doc.slug || doc.documentId,
              score: doc._pulseScore ?? 100,
              warningCount: Array.isArray(doc._pulseWarnings) ? doc._pulseWarnings.length : 0,
              lastAnalyzedAt: doc._lastAnalyzedAt || '',
            });
          }
        } catch (_) {}
      }

      if (format === 'csv') {
        const lines = ['documentId,contentType,title,score,warningCount,lastAnalyzedAt'];
        for (const e of entries) {
          lines.push([e.documentId, e.contentType, `"${(e.title||'').replace(/"/g,'""')}"`, e.score, e.warningCount, e.lastAnalyzedAt].join(','));
        }
        ctx.set('Content-Type', 'text/csv');
        ctx.set('Content-Disposition', 'attachment; filename="contentpulse-export.csv"');
        ctx.body = lines.join('\n');
      } else {
        ctx.set('Content-Type', 'application/json');
        ctx.set('Content-Disposition', 'attachment; filename="contentpulse-export.json"');
        ctx.body = JSON.stringify(entries, null, 2);
      }
    });
  },

  config: {
    default: {
      collections: [],
      warningThreshold: 80,
      maxAgeDays: 365,
    },
  },
};
