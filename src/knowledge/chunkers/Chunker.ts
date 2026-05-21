import { KnowledgeChunk } from "../types";

export interface ChunkMetadata {
  sourceId:        string;
  sourceName:      string;
  type:            KnowledgeChunk["type"];
  category?:       KnowledgeChunk["category"];
  tags:            string[];
  severity?:       KnowledgeChunk["severity"];
  version?:        string;
  sourceUpdatedAt?: string;
  relations?:      KnowledgeChunk["relations"];
}

export interface Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[];
}
