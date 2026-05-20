import { KnowledgeChunk } from "../types";

export interface ChunkMetadata {
  sourceId:        string;
  sourceName:      string;
  type:            KnowledgeChunk["type"];
  tags:            string[];
  severity?:       KnowledgeChunk["severity"];
  version?:        string;
  sourceUpdatedAt?: string;
}

export interface Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[];
}
