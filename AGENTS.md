# AGENTS.md

## What this is
Personal knowledge service. Text query → matches Obsidian notes, PDFs, images, screenshots — all in one 1536-d vector space, all indexed from a GitHub repo (Obsidian syncs there). VN ↔ JP, JP ↔ JP, Image → Knowledge.

Stack: **TypeScript (ESM, strict) + Node 18+ + Fastify + @google/genai + @qdrant/js-client-rest**.

## Phase 1 scope
Server only. No MCP, no Telegram, no Web UI. Clients are thin (curl, future) and call the same API.

## Setup
```bash
npm install
cp .env.example .env   # fill required keys (see Env table)
npm run setup          # create Qdrant collection (idempotent)
npm run dev            # tsx watch on src/server.ts
```
Docker for local Qdrant: `docker run -p 6333:6333 qdrant/qdrant`. Full stack: `docker compose up` (Qdrant + app).

## Scripts
| script | what |
|---|---|
| `dev` | `tsx watch src/server.ts` |
| `start` | `tsx src/server.ts` |
| `setup` | creates the Qdrant collection |
| `sync` | one-shot pull from GitHub (manual) |
| `reembed` | re-vectorize everything after a model bump |
| `test` | `node --import tsx --test src/__tests__/*.test.ts` (pure-logic only, no API keys) |

## Layout (read in this order)
```
src/
  config.ts          env config + validateConfig()
  embed.ts           Gemini Embedding 2 REST — text/image/audio/video/pdf + l2Normalize
  translate.ts       OpenRouter translation + language detect (used by /search)
  transcribe.ts      Gemini transcription (inline <20MB, File API ≥20MB) → segments
  pdf.ts             (placeholder) page splitting for >6-page PDFs
  ingest.ts          detectFileType → chunkText → per-modality → upsert
  sync/
    github.ts        GitHub API client: list changed files, download, verify HMAC
    index.ts         sync orchestrator: dedup by SHA, delete-by-docId on update, sweep missing
    lock.ts          in-process per-docId + global sync mutex
  search.ts          bilingual embed → Qdrant → ranked results (dedup by docId)
  ask.ts             RAG: retrieve K → context → OpenRouter → answer + refs
  vector-store.ts    VectorStore interface + QdrantVectorStore impl
  setup.ts           one-shot collection creator
  reembed.ts         iterate all points, re-embed, upsert (after model bump)
  server.ts          Fastify + multipart + bearer auth + HMAC verify
  __tests__/         node:test, no infra
```

## API
| method | path | auth | purpose |
|---|---|---|---|
| `POST` | `/upload` | bearer | Multipart `file` field. Returns `{id, filename, type, chunks}` |
| `GET`  | `/search?q=...&limit=N` | bearer | Cross-modal text search. Bilingual (VN↔JP). Returns ranked results |
| `POST` | `/ask` | bearer | Body `{q, limit?}`. RAG: retrieve → OpenRouter → `{answer, refs}` |
| `POST` | `/sync` | bearer | Manual GitHub sync. Optional body `{full?: bool}` |
| `POST` | `/webhook/github` | HMAC SHA-256 | GitHub push webhook. Header `X-Hub-Signature-256` |
| `GET`  | `/health` | none | Qdrant + Gemini + GitHub + OpenRouter. 200 healthy / 503 degraded |

Bearer token = `Authorization: Bearer <API_TOKEN>`. Missing/invalid → 401. `/health` always open.

## Pipeline
### Ingest (per file)
1. **Detect** type by extension + MIME (`detectFileType`).
2. **Process** by branch:
   - `image` → `embedImage` raw bytes → 1 vector, payload `content: "[Image: <filename>]"`.
   - `audio`/`video` → `transcribe` → `chunkText` transcript → embed each chunk. **Also** embed raw media via `embedAudio`/`embedVideo` **only if** `durationSeconds ≤ 80` / `≤ 128`. Raw-media point gets `isMediaChunk: true`.
   - `pdf` → `embedPdf` raw bytes (Gemini Embedding 2 supports PDF natively, ≤6 pages). 1 vector per PDF.
   - `text` (`.txt .md .html .csv .json .xml`) → `chunkText` → embed each chunk.
3. **Upsert** to Qdrant (Cosine, L2-normalized). All points carry `docId`, `sha`, `modelVersion`, `lang` (best-effort), `source: 'github' | 'upload'`.

### Sync (GitHub)
1. **Trigger**: webhook (preferred) or polling (`/sync` with `?since=<ISO>`) or manual full (`/sync {full: true}`).
2. **List** changed files since cursor (sha stored in Qdrant payload or in a small cursor file).
3. **For each file**:
   - Skip if `sha` unchanged vs last-seen (recorded in Qdrant payload).
   - Acquire per-`docId` lock.
   - `delete` old points by `docId` (handles updates, not just inserts).
   - Download from GitHub, run ingest pipeline, upsert with `modelVersion`.
4. **Sweep**: list GitHub tree → diff vs Qdrant `docId`s where `source='github'` → delete orphan points.
5. **Concurrency**: single global sync mutex prevents overlapping syncs; per-`docId` lock prevents two syncs from racing the same file.

### Search (bilingual)
1. Detect query language (`vi` | `ja` | `other`).
2. If `vi` or `ja`: translate to the **other** language via OpenRouter.
3. Embed **original** + **translated** query (`embedQuery`, `RETRIEVAL_QUERY`).
4. Run two `Qdrant.search` calls (one per query vector).
5. Merge by `docId`, keep **max score** per `docId`. Slice to top `limit`.
6. Return ranked `{score, filename, type, content, isMediaChunk, lang}`.

Single LLM call per `/search` (only when other-lang detection succeeds). `other` queries → no translation, single search.

### Ask (RAG)
1. Run `search(q, K=8)`.
2. Build context block: `[{i}] {filename} ({type})\n{content}\n` per hit.
3. OpenRouter call: system = "answer with citations like [1], [2]", user = context + `q`.
4. Return `{answer, refs: SearchResult[]}`.

## Env (`.env.example`)
| var | default | notes |
|---|---|---|
| `GEMINI_API_KEY` | — | required |
| `QDRANT_URL` | `http://localhost:6333` | required |
| `QDRANT_API_KEY` | — | required for cloud |
| `QDRANT_COLLECTION` | `multimodal_demo` | |
| `VECTOR_DIM` | `1536` | Gemini Embedding 2 supports 128–3072 |
| `PORT` | `3000` | |
| `API_TOKEN` | — | bearer for `/search` `/ask` `/sync` `/upload`. **required** in prod |
| `GITHUB_TOKEN` | — | PAT or fine-grained token with `contents:read`. **required** |
| `GITHUB_REPO` | — | `owner/repo`. **required** |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret. **required** for webhook |
| `OPENROUTER_API_KEY` | — | **required** for `/search` bilingual + `/ask` |
| `OPENROUTER_MODEL` | `google/gemma-4-26b-a4b-it` | $0.06/M in, $0.33/M out. MoE 3.8B active of 25.2B, 256K ctx, multimodal |
| `EMBED_MODEL_VERSION` | `gemini-embedding-2-preview@1` | bump forces re-embed on next sync |

## Models used
- `gemini-embedding-2-preview` via REST `embedContent` (PDF/image/audio/video/text).
- `gemini-2.5-flash-lite` via `@google/genai` for transcription.
- `google/gemma-4-26b-a4b-it` (MoE, 3.8B active) via OpenRouter for translation + RAG.

## Phase 1 decisions (locked)
| decision | pick | why |
|---|---|---|
| VN ↔ JP | B2: detect → translate other → embed both → search both → merge by `docId` (max score) | JA-VI distant, Gemini Embedding 2 unproven on pair. 1 cheap LLM call, no 2× storage |
| Auth | bearer via `API_TOKEN`, 5-line middleware. Webhook = HMAC SHA-256 | Zero deps, easy to remove later |
| Gemma model | `gemma-4-26b-a4b-it` (MoE) for translate + RAG | $0.06/M in. 31B dense 2× cost, "near-31B quality" claim. Single model = one config line |
| Concurrency | in-process `Map<docId, Promise>` + global `Map<'__sync__', Promise>` | Single process, zero deps. BullMQ only if it breaks |
| Docker | `Dockerfile` + `docker-compose.yml` (Qdrant + app). Webhook exposure = user call | Reproducible, no tunnel opinion |

## Switching vector DB
`vector-store.ts` is the only file to touch. Implement `VectorStore` (4 methods: `ensureCollection`, `upsert`, `search`, `healthCheck`), wire it into `createVectorStore()`. Reference impls for Pinecone/Weaviate/Chroma/Milvus are commented at the bottom of that file.

## Limits
- Audio embed: ≤80s. Video embed: ≤128s. Longer → transcript-only.
- PDF embed: ≤6 pages per request (Gemini cap). Longer → split via `pdf.ts` (add when needed).
- Files ≥20MB use Gemini File API (uploaded, polled, deleted in `finally`).
- GitHub file cap: 100MB (API max). Larger → reject.
- Upload cap: 200MB (Fastify multipart, in-memory `toBuffer`).
- Sync batch cap: 50 files per run, rest skipped (logged for next sync).
- No OCR (screenshots searchable only by visual similarity, not text inside). No reranker. No semantic chunking. No BM25 hybrid.

## Gotchas
- Vectors must be L2-normalized — Qdrant uses Cosine distance. `l2Normalize` is applied inside every embed fn.
- `detectFileType` treats `.pdf` as `pdf` and sends to `embedPdf` (native). Don't add a PDF parser.
- PDF >6 pages errors from Gemini. Most Obsidian PDFs fit; long theses don't. `pdf.ts` is the seam.
- `parseTranscript` regex is `^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:Speaker\s+(\d+)\s*:\s*)?(.*)$` — multi-line segments are joined until the next timestamp.
- The raw-media embed path silently catches errors and continues with text chunks only.
- Sync **must** delete old points by `docId` before upsert — otherwise duplicates accumulate and search returns duplicates.
- Webhook: verify `X-Hub-Signature-256` with `crypto.timingSafeEqual`. Reject on mismatch.
- OpenRouter translation is best-effort. If it fails, fall back to single-language search (don't 500).
- `EMBED_MODEL_VERSION` is stored in payload. On bump, `npm run reembed` walks all points and re-vectors.
- Per-`docId` lock is in-process only — doesn't survive restart, doesn't span multiple app instances. Ponytail: fine for single-box deploy, add Redis lock if you scale out.
