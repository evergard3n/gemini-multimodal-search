/**
 * Configuration — loaded from environment variables.
 *
 * Copy .env.example to .env and fill in your values before running.
 */

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  collectionName: process.env.QDRANT_COLLECTION || 'multimodal_demo',
  vectorDim: parseInt(process.env.VECTOR_DIM || '1536', 10),
  port: parseInt(process.env.PORT || '3000', 10),

  /** Files above this size use Gemini File API instead of inline base64 */
  fileApiThreshold: 20 * 1024 * 1024, // 20 MB

  /** Max duration for multimodal embedding (Gemini limits) */
  maxAudioEmbedSeconds: 80,
  maxVideoEmbedSeconds: 128,
};

export function validateConfig(): void {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required. Get one at https://aistudio.google.com/apikey');
  }
  if (!config.qdrantUrl) {
    throw new Error('QDRANT_URL is required. Get a free cluster at https://cloud.qdrant.io');
  }
}
