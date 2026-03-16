/**
 * Ingestion Pipeline — Upload, Process, Embed, Store
 *
 * Handles all file types through a unified pipeline:
 * 1. Detect file type from extension/MIME
 * 2. Extract or transcribe content
 * 3. Chunk text into embedding-sized pieces
 * 4. Embed chunks (text vectors) + optionally embed raw media (multimodal vectors)
 * 5. Store all vectors in the vector database
 *
 * The result: text, images, audio, and video all become searchable
 * in the same vector space.
 *
 * Uses the VectorStore abstraction — swap Qdrant for Pinecone, Weaviate,
 * Milvus, or Chroma by changing the provider in vector-store.ts.
 */

import { config } from './config.js';
import { createVectorStore } from './vector-store.js';
import { embedDocument, embedImage, embedAudio, embedVideo } from './embed.js';
import { transcribe, type TranscriptionResult } from './transcribe.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestResult {
  id: string;
  filename: string;
  type: 'text' | 'image' | 'audio' | 'video';
  chunks: number;
  mediaEmbedded: boolean;
}

type FileType = 'text' | 'image' | 'audio' | 'video' | 'unsupported';

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mpeg', 'mov', 'avi', 'webm', 'wmv', 'flv', 'mpg', '3gpp']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'html', 'csv', 'json', 'xml']);

export function detectFileType(filename: string, mimeType: string): FileType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) return 'image';
  if (AUDIO_EXTENSIONS.has(ext) || mimeType.startsWith('audio/')) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('video/')) return 'video';
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) return 'text';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'text';

  return 'unsupported';
}

// ---------------------------------------------------------------------------
// Text chunking — simple but effective
// ---------------------------------------------------------------------------

/**
 * Split text into chunks of roughly `targetSize` characters,
 * breaking at paragraph boundaries when possible.
 */
export function chunkText(text: string, targetSize = 1000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > targetSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

/**
 * Ingest a file into the vector database.
 *
 * @param buffer - File content
 * @param filename - Original filename (used for type detection)
 * @param mimeType - MIME type from upload
 * @returns Ingestion result with chunk count and metadata
 */
export async function ingestFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<IngestResult> {
  const fileType = detectFileType(filename, mimeType);

  if (fileType === 'unsupported') {
    throw new Error(`Unsupported file type: ${filename} (${mimeType})`);
  }

  const docId = crypto.randomUUID();
  const store = createVectorStore('qdrant', {
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey,
  });

  console.log(`\nIngesting: ${filename} (${fileType}, ${(buffer.length / 1024).toFixed(0)} KB)`);

  const points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];

  // -------------------------------------------------------------------------
  // Process by type
  // -------------------------------------------------------------------------

  if (fileType === 'image') {
    // Images: embed the raw image directly — no text extraction needed
    console.log('  Embedding image...');
    const vector = await embedImage(buffer, mimeType);

    points.push({
      id: crypto.randomUUID(),
      vector,
      payload: {
        docId,
        filename,
        type: 'image',
        content: `[Image: ${filename}]`,
        mimeType,
      },
    });
  } else if (fileType === 'audio' || fileType === 'video') {
    // Audio/Video: transcribe first, then embed text chunks + optionally raw media

    // Step 1: Transcribe
    console.log(`  Transcribing ${fileType}...`);
    const result: TranscriptionResult = await transcribe(buffer, mimeType);
    console.log(`  Transcript: ${result.segments.length} segments, ${result.durationSeconds}s`);

    // Step 2: Chunk and embed the transcript text
    const chunks = chunkText(result.formattedText);
    console.log(`  Embedding ${chunks.length} text chunks...`);

    for (let i = 0; i < chunks.length; i++) {
      const vector = await embedDocument(chunks[i]);
      points.push({
        id: crypto.randomUUID(),
        vector,
        payload: {
          docId,
          filename,
          type: fileType,
          content: chunks[i],
          chunkIndex: i,
          totalChunks: chunks.length,
          durationSeconds: result.durationSeconds,
          mimeType,
        },
      });
    }

    // Step 3: Optionally embed the raw media for cross-modal search
    const maxSeconds =
      fileType === 'audio' ? config.maxAudioEmbedSeconds : config.maxVideoEmbedSeconds;

    if (result.durationSeconds > 0 && result.durationSeconds <= maxSeconds) {
      console.log(`  Embedding raw ${fileType} (${result.durationSeconds}s)...`);
      try {
        const mediaVector =
          fileType === 'audio'
            ? await embedAudio(buffer, mimeType)
            : await embedVideo(buffer, mimeType);

        points.push({
          id: crypto.randomUUID(),
          vector: mediaVector,
          payload: {
            docId,
            filename,
            type: fileType,
            content: `[${fileType} content: ${filename}]`,
            isMediaChunk: true,
            mediaType: fileType,
            startTime: 0,
            endTime: result.durationSeconds,
            mimeType,
          },
        });
      } catch (err) {
        console.log(`  Multimodal ${fileType} embedding failed (text chunks still indexed):`, (err as Error).message);
      }
    } else if (result.durationSeconds > maxSeconds) {
      console.log(`  Skipping raw ${fileType} embedding (${result.durationSeconds}s > ${maxSeconds}s limit)`);
    }
  } else {
    // Text/PDF: extract text, chunk, embed
    const text = buffer.toString('utf-8');
    const chunks = chunkText(text);
    console.log(`  Embedding ${chunks.length} text chunks...`);

    for (let i = 0; i < chunks.length; i++) {
      const vector = await embedDocument(chunks[i]);
      points.push({
        id: crypto.randomUUID(),
        vector,
        payload: {
          docId,
          filename,
          type: 'text',
          content: chunks[i],
          chunkIndex: i,
          totalChunks: chunks.length,
          mimeType,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Store in vector database
  // -------------------------------------------------------------------------

  console.log(`  Upserting ${points.length} vectors...`);
  await store.upsert(config.collectionName, points);

  const mediaEmbedded = points.some((p) => (p.payload as Record<string, unknown>).isMediaChunk === true);

  console.log(`  Done: ${points.length} vectors stored (media embedded: ${mediaEmbedded})`);

  return {
    id: docId,
    filename,
    type: fileType,
    chunks: points.length,
    mediaEmbedded,
  };
}
