'use strict';

/**
 * ContentPulse Strapi Plugin - Main Entry
 * Strapi v4/v5 Plugin for Semantic Decay & Freshness Analysis
 */

const contentPulseService = require('./src/services/content-pulse');
const lifecycleService = require('./src/services/lifecycle');

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   */
  register({ strapi }) {
    // Register the content-pulse service
    strapi.service('plugin::contentpulse.content-pulse', contentPulseService);

    // Register the lifecycle service
    strapi.service('plugin::contentpulse.lifecycle', lifecycleService);

    // Extend content types with pulse fields
    this.extendContentTypes({ strapi });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   */
  bootstrap({ strapi }) {
    // Register lifecycle hooks for all content types
    const config = strapi.config.get('plugin::contentpulse', {});
    const collections = config.collections || [];

    if (collections.length > 0) {
      lifecycleService.registerHooks({ strapi, collections, config });
      strapi.log.info(`ContentPulse: Monitoring collections [${collections.join(', ')}]`);
    } else {
      strapi.log.warn('ContentPulse: No collections configured. Add plugin::contentpulse.collections to config.');
    }
  },

  /**
   * Extend content types with pulse analysis fields
   */
  extendContentTypes({ strapi }) {
    const config = strapi.config.get('plugin::contentpulse', {});
    const collections = config.collections || [];

    collections.forEach(collectionName => {
      const contentType = strapi.contentTypes[collectionName];
      if (!contentType) {
        strapi.log.warn(`ContentPulse: Collection "${collectionName}" not found`);
        return;
      }

      // Add pulse fields to the content type schema
      contentType.attributes._pulseScore = {
        type: 'integer',
        configurable: false,
        writable: false,
        visible: false,
        default: 100,
      };

      contentType.attributes._pulseWarnings = {
        type: 'json',
        configurable: false,
        writable: false,
        visible: false,
        default: [],
      };

      contentType.attributes._lastAnalyzedAt = {
        type: 'datetime',
        configurable: false,
        writable: false,
        visible: false,
      };
    });
  },

  /**
   * Plugin configuration
   */
  config: {
    collections: [],
    warningThreshold: 80,
    maxAgeDays: 365,
    analyzers: {
      dates: true,
      versions: true,
    },
  },
};
