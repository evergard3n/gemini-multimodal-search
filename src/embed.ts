/**
 * Gemini Embedding 2 — Multimodal Embedding Service
 *
 * Embeds text, images, audio, and video into the same 1536-dimensional vector space.
 * All modalities use the same `embedContent` API endpoint with different content types.
 *
 * Key concepts:
 * - Task types: RETRIEVAL_DOCUMENT (for stored content) vs RETRIEVAL_QUERY (for search queries)
 * - inlineData: base64-encoded content sent directly in the request
 * - L2 normalization: ensures cosine similarity works correctly
 *
 * @see https://ai.google.dev/gemini-api/docs/embeddings
 */

import { config } from './config.js';

const MODEL = 'gemini-embedding-2-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini task types — asymmetric embedding improves retrieval by 5-15% */
type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

interface EmbedRequest {
  model: string;
  content: { parts: Array<Record<string, unknown>> };
  taskType: TaskType;
  outputDimensionality: number;
}

interface EmbedResponse {
  embedding: { values: number[] };
}

// ---------------------------------------------------------------------------
// Core embedding function — all modalities go through here
// ---------------------------------------------------------------------------

async function callEmbedApi(request: EmbedRequest): Promise<number[]> {
  const url = `${API_BASE}/models/${MODEL}:embedContent?key=${config.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: request.content,
      taskType: request.taskType,
      output_dimensionality: request.outputDimensionality,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as EmbedResponse;

  if (!data.embedding?.values) {
    throw new Error('Gemini API returned no embedding values');
  }

  return l2Normalize(data.embedding.values);
}

// ---------------------------------------------------------------------------
// Public API — one function per modality
// ---------------------------------------------------------------------------

/**
 * Embed text for storage (documents, chunks).
 * Uses RETRIEVAL_DOCUMENT task type — optimized for being found.
 */
export async function embedDocument(text: string): Promise<number[]> {
  return callEmbedApi({
    model: MODEL,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: config.vectorDim,
  });
}

/**
 * Embed text for search (user queries).
 * Uses RETRIEVAL_QUERY task type — optimized for finding.
 *
 * Using a different task type for queries vs documents improves
 * retrieval accuracy by 5-15% compared to symmetric embedding.
 */
export async function embedQuery(text: string): Promise<number[]> {
  return callEmbedApi({
    model: MODEL,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: config.vectorDim,
  });
}

/**
 * Embed a raw image (PNG, JPG, WebP, etc.).
 * The image is sent as base64 inlineData — Gemini understands the visual content.
 *
 * Example: a photo of a chart will produce a vector similar to
 * the text description "chart showing revenue growth over time".
 */
export async function embedImage(imageData: Buffer, mimeType: string): Promise<number[]> {
  return callEmbedApi({
    model: MODEL,
    content: {
      parts: [{ inlineData: { mimeType, data: imageData.toString('base64') } }],
    },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: config.vectorDim,
  });
}

/**
 * Embed a raw audio segment (MP3, WAV, etc.).
 * Maximum duration: 80 seconds per request.
 *
 * The audio vector captures speech content, tone, and ambient sounds.
 * A text query like "excited announcement" can match upbeat audio.
 */
export async function embedAudio(audioData: Buffer, mimeType: string): Promise<number[]> {
  return callEmbedApi({
    model: MODEL,
    content: {
      parts: [{ inlineData: { mimeType, data: audioData.toString('base64') } }],
    },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: config.vectorDim,
  });
}

/**
 * Embed a raw video segment (MP4, WebM, etc.).
 * Maximum duration: 128 seconds per request.
 *
 * The video vector captures both visual scenes and audio content.
 * A text query like "product demo on a laptop" can match the visual content.
 */
export async function embedVideo(videoData: Buffer, mimeType: string): Promise<number[]> {
  return callEmbedApi({
    model: MODEL,
    content: {
      parts: [{ inlineData: { mimeType, data: videoData.toString('base64') } }],
    },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: config.vectorDim,
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * L2 normalize a vector so cosine similarity works correctly.
 * Qdrant uses cosine distance by default, which requires normalized vectors.
 */
function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}
