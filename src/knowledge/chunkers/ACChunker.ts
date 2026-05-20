import { KnowledgeChunk } from "../types";
import { Chunker, ChunkMetadata } from "./Chunker";
import { NaiveChunker } from "./NaiveChunker";

// Matches common AC bullet patterns: "- item", "• item", "* item", "1. item", "AC: item"
const AC_BULLET_RE = /^(?:[-•*]|\d+[.)]\s|AC\s*:\s*)/;

const naive = new NaiveChunker();

/**
 * AC-aware chunker — Phase 2.
 * Splits text into one chunk per acceptance-criteria bullet so that semantic
 * search can match individual criteria rather than a merged blob.
 *
 * Detection: if ANY line matches AC_BULLET_RE, the entire text is treated as a
 * bulleted AC block and each non-empty bullet becomes a chunk.
 * Fallback: delegates to NaiveChunker when no bullet pattern is detected.
 */
export class ACChunker implements Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const lines   = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const hasBullets = lines.some(l => AC_BULLET_RE.test(l));

    if (!hasBullets) return naive.chunk(trimmed, metadata);

    return lines
      .filter(l => AC_BULLET_RE.test(l))
      .map(l => l.replace(AC_BULLET_RE, "").trim())
      .filter(Boolean)
      .map(criterion => ({
        text:            criterion,
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
      }));
  }
}
