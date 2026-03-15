/**
 * Setup — Create vector database collection
 *
 * Run this once before using the app:
 *   npm run setup
 *
 * Creates a collection with the configured dimensions and cosine distance.
 * Works with any vector store provider configured in vector-store.ts.
 */

import { config, validateConfig } from './config.js';
import { createVectorStore } from './vector-store.js';

async function setup() {
  validateConfig();

  const store = createVectorStore('qdrant', {
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey,
  });

  console.log(`Creating collection "${config.collectionName}" (${config.vectorDim} dimensions)...`);
  await store.ensureCollection(config.collectionName, config.vectorDim);
  console.log('Done.');
}

setup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
