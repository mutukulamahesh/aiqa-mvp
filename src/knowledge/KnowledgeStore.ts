import { KnowledgeChunk, RetrievedChunk } from "./types";
import { IEmbedder, Embedder } from "./Embedder";
import { VectorIndex } from "./VectorIndex";
import { Reranker } from "./rerankers/Reranker";
import { CosineSimilarityReranker } from "./rerankers/CosineSimilarityReranker";

export class KnowledgeStore {
  private embedder:  IEmbedder;
  private index:     VectorIndex;
  private reranker:  Reranker;

  constructor(opts: {
    indexPath: string;
    embedder?: IEmbedder;
    reranker?: Reranker;
  }) {
    this.embedder = opts.embedder ?? new Embedder();
    this.index    = new VectorIndex(opts.indexPath);
    this.reranker = opts.reranker ?? new CosineSimilarityReranker();
  }

  async ingest(chunks: KnowledgeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const vector = await this.embedder.embed(chunk.text);
      await this.index.add(chunk, vector);
    }
  }

  async retrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
    const vector     = await this.embedder.embed(query);
    const candidates = await this.index.search(vector, topK);
    return this.reranker.rerank(candidates);
  }

  // Phase 2: feedback loop — updates confidence score in the index.
  // Stub in Phase 1: records outcome but does not yet update stored vectors.
  async feedback(_sourceId: string, _outcome: "pass" | "fail" | "flaky"): Promise<void> {
    // Phase 2 implementation: adjust chunk.confidence and re-index
  }

  async clear(): Promise<void> {
    await this.index.clear();
  }

  async size(): Promise<number> {
    return this.index.size();
  }
}
