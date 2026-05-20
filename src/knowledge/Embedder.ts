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

// Deterministic stub for tests and CI — same text always produces the same vector.
// Never downloads any model.
export class StubEmbedder implements IEmbedder {
  async embed(text: string): Promise<number[]> {
    const seed = text.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 384 }, (_, i) => Math.sin(seed + i));
  }
}
