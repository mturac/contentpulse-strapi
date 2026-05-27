'use strict';

/**
 * ContentPulse Lifecycle Service
 * Registers afterCreate and afterUpdate hooks for content analysis
 */

const contentPulseService = require('./content-pulse');

/**
 * Register lifecycle hooks for specified collections
 *
 * @param {Object} options
 * @param {Object} options.strapi - Strapi instance
 * @param {string[]} options.collections - Collection names to monitor
 * @param {Object} options.config - Plugin configuration
 */
function registerHooks({ strapi, collections, config }) {
  const textFields = ['content', 'richText', 'body', 'description', 'excerpt'];

  collections.forEach(collectionName => {
    const contentType = strapi.contentTypes[collectionName];
    if (!contentType) {
      strapi.log.warn(`ContentPulse: Collection "${collectionName}" not found, skipping hooks`);
      return;
    }

    // Get the lifecycle service for this collection
    const collectionService = strapi.service(collectionName);

    if (!collectionService) {
      strapi.log.warn(`ContentPulse: Service for "${collectionName}" not found`);
      return;
    }

    // Store original lifecycle methods
    const originalAfterCreate = collectionService.afterCreate;
    const originalAfterUpdate = collectionService.afterUpdate;

    // Wrap afterCreate hook
    collectionService.afterCreate = async function (event) {
      // Call original hook if exists
      if (originalAfterCreate) {
        await originalAfterCreate.call(this, event);
      }

      // Run pulse analysis
      await runPulseAnalysis({
        strapi,
        event,
        collectionName,
        textFields,
        config,
      });
    };

    // Wrap afterUpdate hook
    collectionService.afterUpdate = async function (event) {
      // Call original hook if exists
      if (originalAfterUpdate) {
        await originalAfterUpdate.call(this, event);
      }

      // Run pulse analysis
      await runPulseAnalysis({
        strapi,
        event,
        collectionName,
        textFields,
        config,
      });
    };

    strapi.log.debug(`ContentPulse: Registered hooks for "${collectionName}"`);
  });
}

/**
 * Run pulse analysis on a document after create/update
 */
async function runPulseAnalysis({ strapi, event, collectionName, textFields, config }) {
  const { result, params } = event;

  // Skip if already analyzing (prevent recursive loops)
  if (result._isAnalyzing) {
    return;
  }

  // Find the first available text field
  const contentToAnalyze = textFields
    .map(field => result[field])
    .find(value => value !== undefined && value !== null);

  if (!contentToAnalyze) {
    return;
  }

  try {
    // Run analysis
    const analysisResult = await contentPulseService.analyzeContent({
      content: contentToAnalyze,
      config,
    });

    // Update document with analysis results
    // Use db.query to avoid triggering lifecycle hooks again
    await strapi.db.query(collectionName).update({
      where: { id: result.id },
      data: {
        _pulseScore: analysisResult.score,
        _pulseWarnings: analysisResult.warnings,
        _lastAnalyzedAt: analysisResult.analyzedAt,
        _isAnalyzing: true, // Temporary flag to prevent recursive updates
      },
    });

    // Clear the analyzing flag
    await strapi.db.query(collectionName).update({
      where: { id: result.id },
      data: {
        _isAnalyzing: false,
      },
    });

    strapi.log.debug(
      `ContentPulse: Analyzed ${collectionName}#${result.id} - Score: ${analysisResult.score}, Warnings: ${analysisResult.warnings.length}`
    );
  } catch (error) {
    // Don't fail the save if analysis fails
    strapi.log.error(`ContentPulse analysis error for ${collectionName}#${result.id}:`, error);
  }
}

module.exports = {
  registerHooks,
  runPulseAnalysis,
};
