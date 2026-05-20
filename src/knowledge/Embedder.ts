import * as crypto from "crypto";

export interface IEmbedder {
  embed(text: string): Promise<number[]>;
}

// Production embedder — lazy-loads all-MiniLM-L6-v2 on first call (~25 MB, cached locally).
// Uses dynamic import so the ESM-only @xenova/transformers loads from CJS without issues.
export class Embedder implements IEmbedder {
  private static pipeline: ((text: string, opts: object) => Promise<{ data: Float32Array }>) | null = null;

  async embed(text: string): Promise<number[]> {
    if (!Embedder.pipeline) {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      Embedder.pipeline = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")) as unknown as ((text: string, opts: object) => Promise<{ data: Float32Array }>);
    }
    const output = await Embedder.pipeline!(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }
}

// Deterministic stub for tests and CI — never downloads any model.
// Spreads SHA-256(text) bytes across 384 float dimensions then L2-normalizes,
// producing near-orthogonal vectors so retrieval ranking assertions are reliable.
export class StubEmbedder implements IEmbedder {
  async embed(text: string): Promise<number[]> {
    const hash = crypto.createHash("sha256").update(text).digest();
    const vec  = Array.from({ length: 384 }, (_, i) => hash[i % hash.byteLength] / 128 - 1);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }
}
