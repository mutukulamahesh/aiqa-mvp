import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";

// Phase 2 — stub only. Implement when Confluence connector is needed.
export class ConfluenceConnector implements KnowledgeConnector {
  readonly name = "confluence";
  constructor(_opts: { baseUrl: string; email: string; apiToken: string; spaceKey: string }) {}
  async fetch(): Promise<KnowledgeChunk[]> { return []; }
}
