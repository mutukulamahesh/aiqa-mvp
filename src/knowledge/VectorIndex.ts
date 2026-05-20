import * as fs   from "fs";
import { LocalIndex, MetadataTypes } from "vectra";
import { KnowledgeChunk, RetrievedChunk } from "./types";

export class VectorIndex {
  private index: LocalIndex;

  constructor(indexPath: string) {
    fs.mkdirSync(indexPath, { recursive: true });
    this.index = new LocalIndex(indexPath);
  }

  async ensureCreated(): Promise<void> {
    if (!await this.index.isIndexCreated()) {
      await this.index.createIndex();
    }
  }

  async add(chunk: KnowledgeChunk, vector: number[]): Promise<void> {
    await this.ensureCreated();
    await this.index.insertItem({ vector, metadata: chunk as unknown as Record<string, MetadataTypes> });
  }

  async search(vector: number[], topK: number): Promise<RetrievedChunk[]> {
    if (!await this.index.isIndexCreated()) return [];
    const results = await this.index.queryItems(vector, "", topK);
    return results.map(r => ({
      ...(r.item.metadata as unknown as KnowledgeChunk),
      score: r.score,
    }));
  }

  async delete(sourceId: string): Promise<void> {
    if (!await this.index.isIndexCreated()) return;
    const all = await this.index.listItems();
    const matches = all.filter(item => (item.metadata as unknown as KnowledgeChunk).sourceId === sourceId);
    for (const item of matches) {
      await this.index.deleteItem(item.id);
    }
  }

  async clear(): Promise<void> {
    if (await this.index.isIndexCreated()) {
      await this.index.deleteIndex();
    }
  }

  async size(): Promise<number> {
    if (!await this.index.isIndexCreated()) return 0;
    const stats = await this.index.listItems();
    return stats.length;
  }
}
