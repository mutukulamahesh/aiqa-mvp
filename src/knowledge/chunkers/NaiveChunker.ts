import { KnowledgeChunk } from "../types";
import { Chunker, ChunkMetadata } from "./Chunker";

const MAX_CHARS = 2000;

export class NaiveChunker implements Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const chunks: KnowledgeChunk[] = [];
    let offset = 0;

    while (offset < trimmed.length) {
      const slice = trimmed.slice(offset, offset + MAX_CHARS);
      chunks.push({
        text:       slice,
        sourceId:   metadata.sourceId,
        sourceName: metadata.sourceName,
        type:       metadata.type,
        tags:       metadata.tags,
        severity:   metadata.severity,
        version:    metadata.version,
        confidence: 1.0,
        relations:  [],
        ingestedAt: new Date().toISOString(),
      });
      offset += MAX_CHARS;
    }

    return chunks;
  }
}
