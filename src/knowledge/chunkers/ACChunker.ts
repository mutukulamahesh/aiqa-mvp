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
 * Mixed documents (summary + prose + bullets):
 *   - Non-bullet lines are joined and emitted as a single NaiveChunker chunk
 *     so context (summary, description) is not silently discarded.
 *   - Each bullet line becomes its own chunk.
 *
 * All-prose documents (no bullets detected): delegates entirely to NaiveChunker.
 */
export class ACChunker implements Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const lines      = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const hasBullets = lines.some(l => AC_BULLET_RE.test(l));

    if (!hasBullets) return naive.chunk(trimmed, metadata);

    const results: KnowledgeChunk[] = [];

    // Emit non-bullet narrative as a NaiveChunker chunk so summary/description is indexed
    const proseLines = lines.filter(l => !AC_BULLET_RE.test(l));
    if (proseLines.length > 0) {
      results.push(...naive.chunk(proseLines.join("\n"), metadata));
    }

    // Emit one chunk per AC bullet
    const bulletChunks: KnowledgeChunk[] = lines
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

    results.push(...bulletChunks);
    return results;
  }
}
