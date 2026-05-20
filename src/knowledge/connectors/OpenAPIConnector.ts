import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";

// Phase 2 — stub only. Implement when OpenAPI connector is needed.
export class OpenAPIConnector implements KnowledgeConnector {
  readonly name = "openapi";
  constructor(_opts: { url: string }) {}
  async fetch(): Promise<KnowledgeChunk[]> { return []; }
}
