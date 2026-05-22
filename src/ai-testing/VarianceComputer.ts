import { IEmbedder } from "../knowledge/Embedder";

export class VarianceComputer {
  constructor(private readonly embedder: IEmbedder) {}

  async compute(responses: string[], metric: "max" | "mean" = "max"): Promise<number> {
    if (responses.length < 2) return 0;

    const embeddings = await Promise.all(responses.map(r => this.embedder.embed(r)));

    const distances: number[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        distances.push(cosineDist(embeddings[i], embeddings[j]));
      }
    }

    return metric === "max"
      ? Math.max(...distances)
      : distances.reduce((a, b) => a + b, 0) / distances.length;
  }
}

export function cosineDist(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
