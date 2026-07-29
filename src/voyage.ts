const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
const OUTPUT_DIMENSION = 1024;
const RATE_LIMIT_WAIT_MS = 25_000;
const MAX_RATE_LIMIT_RETRIES = 5;

interface VoyageResponse { data?: Array<{ embedding?: number[] }>; detail?: string }

export async function createEmbeddings(inputs: string[], inputType: "document" | "query", apiKey: string): Promise<number[][]> {
  for (let retry = 0; retry <= MAX_RATE_LIMIT_RETRIES; retry++) {
    const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: inputs, model: "voyage-4-lite", input_type: inputType, output_dimension: OUTPUT_DIMENSION }),
    });
    const body = (await response.json()) as VoyageResponse;

    if (response.status === 429 && retry < MAX_RATE_LIMIT_RETRIES) {
      console.warn(`Voyage rate limit reached. Waiting 25 seconds before retry ${retry + 1}/${MAX_RATE_LIMIT_RETRIES}.`);
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      continue;
    }
    if (!response.ok) throw new Error(`Voyage embeddings request failed (${response.status}): ${body.detail ?? response.statusText}`);

    const embeddings = body.data?.map((item) => item.embedding);
    if (!embeddings || embeddings.some((embedding) => !embedding || embedding.length !== OUTPUT_DIMENSION)) {
      throw new Error("Voyage returned missing or incorrectly sized embeddings");
    }
    return embeddings as number[][];
  }

  throw new Error("Voyage embeddings request failed after rate-limit retries");
}
