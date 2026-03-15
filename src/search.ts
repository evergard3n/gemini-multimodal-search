/**
 * Search — Query across all modalities
 *
 * Embeds the user's text query with RETRIEVAL_QUERY task type,
 * then searches the vector database for the nearest vectors — regardless
 * of whether those vectors came from text, images, audio, or video.
 *
 * This is the core of cross-modal search: a text query like
 * "chart showing revenue growth" can match against an actual image of a chart.
 *
 * Uses the VectorStore abstraction — works with Qdrant, Pinecone, Weaviate, etc.
 */

import { config } from './config.js';
import { embedQuery } from './embed.js';
import { createVectorStore } from './vector-store.js';

export interface SearchResult {
  score: number;
  filename: string;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Search the vector database with a text query.
 *
 * @param query - Natural language search query
 * @param limit - Maximum number of results (default: 5)
 * @returns Ranked search results from all modalities
 */
export async function search(query: string, limit = 5): Promise<SearchResult[]> {
  const store = createVectorStore('qdrant', {
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey,
  });

  // Embed the query with RETRIEVAL_QUERY task type
  // This is different from RETRIEVAL_DOCUMENT — the asymmetry improves retrieval
  const queryVector = await embedQuery(query);

  // Search across ALL vectors in the collection
  // Text chunks, image vectors, audio vectors, video vectors — all in one search
  const results = await store.search(config.collectionName, queryVector, limit);

  return results.map((result) => ({
    score: result.score,
    filename: (result.payload.filename as string) || 'unknown',
    type: (result.payload.type as string) || 'text',
    content: (result.payload.content as string) || '',
    metadata: result.payload,
  }));
}
