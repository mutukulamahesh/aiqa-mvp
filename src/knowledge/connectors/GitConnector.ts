import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";

// Phase 2 — stub only. Implement when Git connector is needed.
export class GitConnector implements KnowledgeConnector {
  readonly name = "git";
  constructor(_opts: { lookbackDays?: number }) {}
  async fetch(): Promise<KnowledgeChunk[]> { return []; }
}
