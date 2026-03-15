/**
 * Vector Store — Abstraction layer for vector databases
 *
 * This module defines a simple interface that any vector database can implement.
 * The default implementation uses Qdrant, but you can swap it for Pinecone,
 * Weaviate, Milvus, Chroma, or any other vector DB by implementing VectorStore.
 *
 * See the bottom of this file for example implementations of other providers.
 *
 * Usage:
 *   import { createVectorStore } from './vector-store.js';
 *   const store = createVectorStore('qdrant'); // or 'pinecone', 'weaviate', etc.
 */

// ---------------------------------------------------------------------------
// Interface — implement this for any vector database
// ---------------------------------------------------------------------------

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface VectorStore {
  /** Create the collection/index if it doesn't exist */
  ensureCollection(name: string, dimensions: number): Promise<void>;

  /** Insert or update vectors */
  upsert(collection: string, points: VectorPoint[]): Promise<void>;

  /** Search by vector similarity */
  search(collection: string, vector: number[], limit: number): Promise<SearchHit[]>;

  /** Check connectivity */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Qdrant implementation (default)
// ---------------------------------------------------------------------------

import { QdrantClient } from '@qdrant/js-client-rest';

export class QdrantVectorStore implements VectorStore {
  private client: QdrantClient;

  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey });
  }

  async ensureCollection(name: string, dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === name);
    if (exists) return;

    await this.client.createCollection(name, {
      vectors: { size: dimensions, distance: 'Cosine' },
    });
  }

  async upsert(collection: string, points: VectorPoint[]): Promise<void> {
    await this.client.upsert(collection, { points });
  }

  async search(collection: string, vector: number[], limit: number): Promise<SearchHit[]> {
    const results = await this.client.search(collection, {
      vector,
      limit,
      with_payload: true,
    });

    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: (r.payload as Record<string, unknown>) || {},
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVectorStore(
  provider: 'qdrant' = 'qdrant',
  options: { url: string; apiKey?: string },
): VectorStore {
  switch (provider) {
    case 'qdrant':
      return new QdrantVectorStore(options.url, options.apiKey);

    // Add more providers here:
    // case 'pinecone':
    //   return new PineconeVectorStore(options);
    // case 'weaviate':
    //   return new WeaviateVectorStore(options);

    default:
      throw new Error(`Unknown vector store provider: ${provider}`);
  }
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  EXAMPLE IMPLEMENTATIONS FOR OTHER VECTOR DATABASES                     ║
// ║                                                                         ║
// ║  These are reference implementations — install the corresponding        ║
// ║  npm package and uncomment to use.                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ---------------------------------------------------------------------------
// Pinecone — npm install @pinecone-database/pinecone
// ---------------------------------------------------------------------------
//
// import { Pinecone } from '@pinecone-database/pinecone';
//
// export class PineconeVectorStore implements VectorStore {
//   private client: Pinecone;
//
//   constructor(apiKey: string) {
//     this.client = new Pinecone({ apiKey });
//   }
//
//   async ensureCollection(name: string, dimensions: number): Promise<void> {
//     const indexes = await this.client.listIndexes();
//     const exists = indexes.indexes?.some((i) => i.name === name);
//     if (exists) return;
//
//     await this.client.createIndex({
//       name,
//       dimension: dimensions,
//       metric: 'cosine',
//       spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
//     });
//
//     // Pinecone indexes take a few seconds to initialize
//     await new Promise((r) => setTimeout(r, 5000));
//   }
//
//   async upsert(collection: string, points: VectorPoint[]): Promise<void> {
//     const index = this.client.index(collection);
//     await index.upsert(
//       points.map((p) => ({
//         id: p.id,
//         values: p.vector,
//         metadata: p.payload,
//       })),
//     );
//   }
//
//   async search(collection: string, vector: number[], limit: number): Promise<SearchHit[]> {
//     const index = this.client.index(collection);
//     const results = await index.query({
//       vector,
//       topK: limit,
//       includeMetadata: true,
//     });
//
//     return (results.matches || []).map((m) => ({
//       id: m.id,
//       score: m.score || 0,
//       payload: (m.metadata as Record<string, unknown>) || {},
//     }));
//   }
//
//   async healthCheck(): Promise<boolean> {
//     try {
//       await this.client.listIndexes();
//       return true;
//     } catch {
//       return false;
//     }
//   }
// }

// ---------------------------------------------------------------------------
// Weaviate — npm install weaviate-client
// ---------------------------------------------------------------------------
//
// import weaviate, { WeaviateClient } from 'weaviate-client';
//
// export class WeaviateVectorStore implements VectorStore {
//   private client: WeaviateClient;
//
//   constructor(url: string, apiKey?: string) {
//     this.client = weaviate.connectToCustom({
//       httpHost: new URL(url).hostname,
//       httpPort: parseInt(new URL(url).port || '8080'),
//       httpSecure: url.startsWith('https'),
//       authCredentials: apiKey ? new weaviate.ApiKey(apiKey) : undefined,
//     });
//   }
//
//   async ensureCollection(name: string, _dimensions: number): Promise<void> {
//     const exists = await this.client.collections.exists(name);
//     if (exists) return;
//
//     await this.client.collections.create({
//       name,
//       vectorizers: weaviate.configure.vectorizer.none(),
//     });
//   }
//
//   async upsert(collection: string, points: VectorPoint[]): Promise<void> {
//     const col = this.client.collections.get(collection);
//     for (const point of points) {
//       await col.data.insert({
//         properties: point.payload,
//         vectors: point.vector,
//         id: point.id,
//       });
//     }
//   }
//
//   async search(collection: string, vector: number[], limit: number): Promise<SearchHit[]> {
//     const col = this.client.collections.get(collection);
//     const results = await col.query.nearVector(vector, { limit });
//
//     return results.objects.map((obj) => ({
//       id: obj.uuid,
//       score: obj.metadata?.distance ? 1 - obj.metadata.distance : 0,
//       payload: obj.properties as Record<string, unknown>,
//     }));
//   }
//
//   async healthCheck(): Promise<boolean> {
//     try {
//       return await this.client.isReady();
//     } catch {
//       return false;
//     }
//   }
// }

// ---------------------------------------------------------------------------
// ChromaDB — npm install chromadb
// ---------------------------------------------------------------------------
//
// import { ChromaClient } from 'chromadb';
//
// export class ChromaVectorStore implements VectorStore {
//   private client: ChromaClient;
//
//   constructor(url: string) {
//     this.client = new ChromaClient({ path: url });
//   }
//
//   async ensureCollection(name: string, _dimensions: number): Promise<void> {
//     await this.client.getOrCreateCollection({
//       name,
//       metadata: { 'hnsw:space': 'cosine' },
//     });
//   }
//
//   async upsert(collection: string, points: VectorPoint[]): Promise<void> {
//     const col = await this.client.getCollection({ name: collection });
//     await col.upsert({
//       ids: points.map((p) => p.id),
//       embeddings: points.map((p) => p.vector),
//       metadatas: points.map((p) => p.payload as Record<string, string | number | boolean>),
//       documents: points.map((p) => (p.payload.content as string) || ''),
//     });
//   }
//
//   async search(collection: string, vector: number[], limit: number): Promise<SearchHit[]> {
//     const col = await this.client.getCollection({ name: collection });
//     const results = await col.query({
//       queryEmbeddings: [vector],
//       nResults: limit,
//       include: ['metadatas', 'distances'],
//     });
//
//     return (results.ids[0] || []).map((id, i) => ({
//       id,
//       score: results.distances ? 1 - (results.distances[0]?.[i] || 0) : 0,
//       payload: (results.metadatas?.[0]?.[i] as Record<string, unknown>) || {},
//     }));
//   }
//
//   async healthCheck(): Promise<boolean> {
//     try {
//       await this.client.heartbeat();
//       return true;
//     } catch {
//       return false;
//     }
//   }
// }

// ---------------------------------------------------------------------------
// Milvus — npm install @zilliz/milvus2-sdk-node
// ---------------------------------------------------------------------------
//
// import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
//
// export class MilvusVectorStore implements VectorStore {
//   private client: MilvusClient;
//
//   constructor(url: string, token?: string) {
//     this.client = new MilvusClient({ address: url, token });
//   }
//
//   async ensureCollection(name: string, dimensions: number): Promise<void> {
//     const exists = await this.client.hasCollection({ collection_name: name });
//     if (exists.value) return;
//
//     await this.client.createCollection({
//       collection_name: name,
//       fields: [
//         { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
//         { name: 'vector', data_type: DataType.FloatVector, dim: dimensions },
//         { name: 'payload', data_type: DataType.JSON },
//       ],
//       index_params: [
//         { field_name: 'vector', index_type: 'HNSW', metric_type: 'COSINE', params: { M: 16, efConstruction: 256 } },
//       ],
//     });
//
//     await this.client.loadCollection({ collection_name: name });
//   }
//
//   async upsert(collection: string, points: VectorPoint[]): Promise<void> {
//     await this.client.insert({
//       collection_name: collection,
//       data: points.map((p) => ({
//         id: p.id,
//         vector: p.vector,
//         payload: p.payload,
//       })),
//     });
//   }
//
//   async search(collection: string, vector: number[], limit: number): Promise<SearchHit[]> {
//     const results = await this.client.search({
//       collection_name: collection,
//       vector,
//       limit,
//       output_fields: ['payload'],
//     });
//
//     return results.results.map((r) => ({
//       id: String(r.id),
//       score: r.score,
//       payload: (r.payload as Record<string, unknown>) || {},
//     }));
//   }
//
//   async healthCheck(): Promise<boolean> {
//     try {
//       await this.client.checkHealth();
//       return true;
//     } catch {
//       return false;
//     }
//   }
// }
