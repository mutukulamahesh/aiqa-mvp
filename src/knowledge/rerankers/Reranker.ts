import { RetrievedChunk } from "../types";

export interface Reranker {
  rerank(candidates: RetrievedChunk[]): RetrievedChunk[];
}
