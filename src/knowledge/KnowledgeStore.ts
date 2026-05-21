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

  // Feedback loop: adjusts stored confidence for all chunks belonging to sourceId.
  // pass → +0.05, fail → -0.10, flaky → -0.03 (clamped to [0, 1]).
  async feedback(sourceId: string, outcome: "pass" | "fail" | "flaky"): Promise<void> {
    const DELTA: Record<string, number> = { pass: 0.05, fail: -0.10, flaky: -0.03 };
    await this.index.updateConfidence(sourceId, DELTA[outcome]);
  }

  async listAll(): Promise<KnowledgeChunk[]> {
    return this.index.listAll();
  }

  async clear(): Promise<void> {
    await this.index.clear();
  }

  async size(): Promise<number> {
    return this.index.size();
  }
}
