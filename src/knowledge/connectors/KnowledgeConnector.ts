import { KnowledgeChunk } from "../types";

export interface KnowledgeConnector {
  readonly name: string;
  fetch(): Promise<KnowledgeChunk[]>;
}
