import { IngestMeta } from "./KnowledgeIngester";

export type HealthStatus = "GOOD" | "WARN" | "STALE" | "EMPTY";

export interface HealthReport {
  status:        HealthStatus;
  totalChunks:   number;
  ageDays:       number | null;
  sources:       { name: string; chunks: number }[];
  message:       string;
}

const WARN_DAYS  = 14;
const STALE_DAYS = 30;

export class HealthScorer {
  score(meta: IngestMeta | null): HealthReport {
    if (!meta || meta.totalChunks === 0) {
      return {
        status: "EMPTY", totalChunks: 0, ageDays: null,
        sources: [], message: "No knowledge index found. Run: aiqa knowledge ingest",
      };
    }

    const ageDays = Math.floor(
      (Date.now() - new Date(meta.lastIngestedAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    if (!Number.isFinite(ageDays)) {
      return {
        status: "STALE", totalChunks: meta.totalChunks, ageDays: null,
        sources: meta.sources, message: "Index has an invalid date — re-ingest recommended (aiqa knowledge ingest)",
      };
    }

    let status: HealthStatus;
    let message: string;

    if (ageDays >= STALE_DAYS) {
      status  = "STALE";
      message = `Index is ${ageDays} days old — re-ingest recommended (aiqa knowledge ingest)`;
    } else if (ageDays >= WARN_DAYS) {
      status  = "WARN";
      message = `Index is ${ageDays} days old — consider refreshing`;
    } else {
      status  = "GOOD";
      message = `Index is healthy (${meta.totalChunks} chunks, ${ageDays} day${ageDays === 1 ? "" : "s"} old)`;
    }

    return { status, totalChunks: meta.totalChunks, ageDays, sources: meta.sources, message };
  }
}
