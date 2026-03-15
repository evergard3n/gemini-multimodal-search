/**
 * Gemini Transcription — Audio & Video to Text
 *
 * Uses Gemini's generative API to transcribe audio/video files with:
 * - Timestamps at section/topic changes
 * - Speaker diarization (Speaker 1, Speaker 2, etc.)
 * - Non-verbal audio cues ([music], [applause], [silence])
 *
 * Two upload paths:
 * - Small files (<20MB): sent as base64 inlineData (faster)
 * - Large files (>=20MB): uploaded via Gemini File API (handles up to 2GB)
 *
 * @see https://ai.google.dev/gemini-api/docs/audio
 * @see https://ai.google.dev/gemini-api/docs/vision#video
 */

import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
  speaker?: number;
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  fullText: string;
  formattedText: string;
  durationSeconds: number;
}

const TRANSCRIPTION_PROMPT = `Please provide a complete transcription of this media. Include:
1. A full word-for-word transcript of all spoken content
2. Use [MM:SS] timestamps at the start of each major section or topic change
3. Identify different speakers if there are multiple (use "Speaker 1:", "Speaker 2:", etc.)
4. Note any significant non-verbal audio (e.g., [music], [applause], [silence])

Format the transcript in a readable way with proper paragraphs. Do not summarize - provide the complete spoken content.`;

// ---------------------------------------------------------------------------
// Main transcription function
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio or video file using Gemini.
 *
 * @param buffer - File content as a Buffer
 * @param mimeType - MIME type (e.g., "audio/mpeg", "video/mp4")
 * @returns Structured transcription with timestamps and speaker labels
 */
export async function transcribe(
  buffer: Buffer,
  mimeType: string,
): Promise<TranscriptionResult> {
  let rawTranscript: string;

  if (buffer.length < config.fileApiThreshold) {
    rawTranscript = await transcribeInline(buffer, mimeType);
  } else {
    rawTranscript = await transcribeViaFileApi(buffer, mimeType);
  }

  return parseTranscript(rawTranscript);
}

// ---------------------------------------------------------------------------
// Small file path — inline base64
// ---------------------------------------------------------------------------

async function transcribeInline(buffer: Buffer, mimeType: string): Promise<string> {
  const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: [
      { inlineData: { mimeType, data: buffer.toString('base64') } },
      { text: TRANSCRIPTION_PROMPT },
    ],
  });

  return response.text ?? '';
}

// ---------------------------------------------------------------------------
// Large file path — Gemini File API
// ---------------------------------------------------------------------------

async function transcribeViaFileApi(buffer: Buffer, mimeType: string): Promise<string> {
  const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  // Step 1: Upload file to Gemini's File API
  console.log(`  Uploading ${(buffer.length / 1024 / 1024).toFixed(1)}MB to Gemini File API...`);

  const uploadResult = await genai.files.upload({
    file: new Blob(
      [buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)] as BlobPart[],
      { type: mimeType },
    ),
    config: { mimeType },
  });

  if (!uploadResult?.uri) {
    throw new Error('File API upload failed: no URI returned');
  }

  const fileUri = uploadResult.uri;
  const fileName = uploadResult.name!;

  try {
    // Step 2: Poll until file is ready
    console.log('  Waiting for file processing...');
    await waitForActive(genai, fileName);

    // Step 3: Transcribe using the uploaded file
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [
        { fileData: { fileUri } },
        { text: TRANSCRIPTION_PROMPT },
      ],
    });

    return response.text ?? '';
  } finally {
    // Step 4: Clean up — delete the uploaded file
    try {
      await genai.files.delete({ name: fileName });
    } catch {
      // Cleanup failure is non-critical
    }
  }
}

/**
 * Poll until a Gemini File API upload is ready for use.
 */
async function waitForActive(genai: GoogleGenAI, fileName: string): Promise<void> {
  const timeout = 120_000; // 2 minutes
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const file = await genai.files.get({ name: fileName });

    if (file.state === 'ACTIVE') return;
    if (file.state === 'FAILED') throw new Error('File processing failed');

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('File API upload timed out');
}

// ---------------------------------------------------------------------------
// Transcript parsing — turns Gemini's text output into structured segments
// ---------------------------------------------------------------------------

/**
 * Parse Gemini's free-text transcript into structured segments.
 *
 * Handles patterns like:
 * - [0:00] Speaker 1: Hello, welcome...
 * - [1:23] The next topic is...
 * - [1:02:34] Speaker 2: For the final section...
 */
function parseTranscript(raw: string): TranscriptionResult {
  const lines = raw.split('\n');
  const segments: TranscriptSegment[] = [];
  let current: { start: number; speaker?: number; text: string } | null = null;

  const timestampRe = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:Speaker\s+(\d+)\s*:\s*)?(.*)$/i;

  for (const line of lines) {
    const match = line.match(timestampRe);

    if (match) {
      // Finalize previous segment
      if (current) {
        segments.push({
          text: current.text.trim(),
          startSeconds: current.start,
          endSeconds: parseTimestamp(match[1]),
          speaker: current.speaker,
        });
      }
      current = {
        start: parseTimestamp(match[1]),
        speaker: match[2] ? parseInt(match[2], 10) : undefined,
        text: match[3] || '',
      };
    } else if (current && line.trim()) {
      current.text += ' ' + line.trim();
    }
  }

  // Finalize last segment
  if (current) {
    segments.push({
      text: current.text.trim(),
      startSeconds: current.start,
      endSeconds: current.start + 30, // estimate
      speaker: current.speaker,
    });
  }

  // Fallback: if no timestamps found, treat everything as one segment
  if (segments.length === 0 && raw.trim()) {
    segments.push({ text: raw.trim(), startSeconds: 0, endSeconds: 0 });
  }

  const fullText = segments.map((s) => s.text).join(' ');
  const formattedText = segments
    .map((s) => {
      const ts = formatTimestamp(s.startSeconds);
      const speaker = s.speaker !== undefined ? ` Speaker ${s.speaker}: ` : ' ';
      return `[${ts}]${speaker}${s.text}`;
    })
    .join('\n\n');

  const duration = segments.length > 0 ? segments[segments.length - 1].endSeconds : 0;

  return { segments, fullText, formattedText, durationSeconds: duration };
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
