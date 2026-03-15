/**
 * Server — 3 endpoints for multimodal search
 *
 * POST /upload  — Upload any file (text, image, audio, video)
 * GET  /search  — Search across all modalities
 * GET  /health  — Check service connectivity
 *
 * Start with: npm run dev (watch mode) or npm start
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config, validateConfig } from './config.js';
import { ingestFile } from './ingest.js';
import { search } from './search.js';
import { createVectorStore } from './vector-store.js';

async function main() {
  validateConfig();

  const app = Fastify({ logger: true });

  // Register multipart for file uploads (200MB limit)
  await app.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  // ---------------------------------------------------------------------------
  // POST /upload — Upload and ingest a file
  // ---------------------------------------------------------------------------

  app.post('/upload', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const buffer = await file.toBuffer();
    const result = await ingestFile(buffer, file.filename, file.mimetype);

    return reply.send({
      success: true,
      ...result,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /search?q=...&limit=5 — Search across all modalities
  // ---------------------------------------------------------------------------

  app.get('/search', async (request, reply) => {
    const { q, limit } = request.query as { q?: string; limit?: string };

    if (!q) {
      return reply.code(400).send({ error: 'Query parameter "q" is required' });
    }

    const results = await search(q, parseInt(limit || '5', 10));

    return reply.send({
      query: q,
      results: results.map((r) => ({
        score: Math.round(r.score * 1000) / 1000,
        filename: r.filename,
        type: r.type,
        content: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
        isMediaChunk: r.metadata.isMediaChunk || false,
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // GET /health — Check connectivity
  // ---------------------------------------------------------------------------

  app.get('/health', async (_request, reply) => {
    const checks: Record<string, string> = {};

    // Check vector store
    try {
      const store = createVectorStore('qdrant', {
        url: config.qdrantUrl,
        apiKey: config.qdrantApiKey,
      });
      const healthy = await store.healthCheck();
      checks.vectorStore = healthy ? `ok (${config.collectionName})` : 'not reachable';
    } catch (err) {
      checks.vectorStore = `error: ${(err as Error).message}`;
    }

    // Check Gemini
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}`,
      );
      checks.gemini = res.ok ? 'ok' : `error: ${res.status}`;
    } catch (err) {
      checks.gemini = `error: ${(err as Error).message}`;
    }

    const allOk = Object.values(checks).every((v) => v.startsWith('ok'));

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'healthy' : 'degraded',
      checks,
    });
  });

  // ---------------------------------------------------------------------------
  // Start server
  // ---------------------------------------------------------------------------

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`\nMultimodal Search API running on http://localhost:${config.port}`);
  console.log(`  POST /upload  — Upload a file (text, image, audio, video)`);
  console.log(`  GET  /search?q=your+query — Search across all modalities`);
  console.log(`  GET  /health  — Check service connectivity\n`);
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
