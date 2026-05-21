import { KnowledgeChunk } from "./types";

export interface ReadinessReport {
  tag:              string;
  status:           "READY" | "PARTIAL" | "MISSING";
  storyCount:       number;
  defectCount:      number;
  totalChunks:      number;
  avgConfidence:    number;
  oldestChunkDays:  number | null;
  message:          string;
}

/**
 * Scores the knowledge coverage for a specific tag (feature area / component).
 *
 * READY   — stories + defect history present, confidence healthy
 * PARTIAL — some coverage but missing stories or defects, or low confidence
 * MISSING — no chunks at all for the tag
 *
 * Designed for: `aiqa knowledge readiness --tag <tag>`
 * Future: release gates, deployment risk scoring, intelligent execution depth.
 */
export class ReadinessScorer {
  score(tag: string, chunks: KnowledgeChunk[]): ReadinessReport {
    const tagged = chunks.filter(c => c.tags.includes(tag));

    if (tagged.length === 0) {
      return {
        tag, status: "MISSING",
        storyCount: 0, defectCount: 0, totalChunks: 0,
        avgConfidence: 0, oldestChunkDays: null,
        message: `No knowledge chunks tagged "${tag}" — ingest Jira stories and defects for this area first`,
      };
    }

    const stories  = tagged.filter(c => c.type === "story");
    const defects  = tagged.filter(c => c.type === "defect");
    const avgConf  = tagged.reduce((s, c) => s + c.confidence, 0) / tagged.length;
    const oldest   = this.oldestDays(tagged);

    const hasStories  = stories.length  > 0;
    const hasDefects  = defects.length  > 0;
    const confHealthy = avgConf >= 0.6;

    const status: ReadinessReport["status"] =
      (hasStories && hasDefects && confHealthy) ? "READY" :
      (hasStories || hasDefects)                ? "PARTIAL" :
      "MISSING";

    const reasons: string[] = [];
    if (!hasStories) reasons.push("no story chunks");
    if (!hasDefects) reasons.push("no defect history");
    if (!confHealthy) reasons.push(`low avg confidence (${avgConf.toFixed(2)})`);

    const message = status === "READY"
      ? `"${tag}" is well-covered: ${stories.length} story chunk(s), ${defects.length} defect(s), confidence ${avgConf.toFixed(2)}`
      : `"${tag}" has partial coverage — ${reasons.join(", ")}`;

    return {
      tag, status,
      storyCount:      stories.length,
      defectCount:     defects.length,
      totalChunks:     tagged.length,
      avgConfidence:   Number(avgConf.toFixed(3)),
      oldestChunkDays: oldest,
      message,
    };
  }

  private oldestDays(chunks: KnowledgeChunk[]): number | null {
    let oldest: number | null = null;
    const now = Date.now();
    for (const c of chunks) {
      const ts = Date.parse(c.sourceUpdatedAt ?? c.ingestedAt);
      if (!Number.isFinite(ts)) continue;
      const days = (now - ts) / (1000 * 60 * 60 * 24);
      if (oldest === null || days > oldest) oldest = days;
    }
    return oldest !== null ? Math.round(oldest) : null;
  }
}
