import { KnowledgeChunk } from "../types";
import { Chunker, ChunkMetadata } from "./Chunker";

// all-MiniLM-L6-v2 accepts 256 tokens ≈ 700–900 English chars; 600 leaves a safe margin.
const MAX_CHARS = 600;

export class NaiveChunker implements Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const chunks: KnowledgeChunk[] = [];
    let offset = 0;

    while (offset < trimmed.length) {
      const slice = trimmed.slice(offset, offset + MAX_CHARS);
      chunks.push({
        text:            slice,
        sourceId:        metadata.sourceId,
        sourceName:      metadata.sourceName,
        type:            metadata.type,
        tags:            metadata.tags,
        severity:        metadata.severity,
        version:         metadata.version,
        sourceUpdatedAt: metadata.sourceUpdatedAt,
        confidence:      1.0,
        relations:       [],
        ingestedAt:      new Date().toISOString(),
      });
      offset += MAX_CHARS;
    }

    return chunks;
  }
}
