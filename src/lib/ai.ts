/**
 * Ollama AI Integration with Streaming Support
 * Optimized for low-latency token streaming
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma:latest";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  num_ctx?: number;
  keep_alive?: string;
}

/**
 * Stream chat completion from Ollama
 * Returns an async generator that yields content chunks
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const model = options.model || DEFAULT_MODEL;

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_ctx: options.num_ctx ?? 4096,
      },
      keep_alive: options.keep_alive ?? "5m",
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("No response body from Ollama");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete JSON lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const chunk: OllamaStreamChunk = JSON.parse(line);

          if (chunk.message?.content) {
            yield chunk.message.content;
          }

          if (chunk.done) {
            return;
          }
        } catch (e) {
          // Skip malformed JSON lines
          console.error("Failed to parse Ollama chunk:", line);
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(buffer);
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
      } catch {
        // Ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat for simple responses
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const model = options.model || DEFAULT_MODEL;

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_ctx: options.num_ctx ?? 4096,
      },
      keep_alive: options.keep_alive ?? "5m",
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.message?.content || "";
}

/**
 * Generate a chat title from the first message
 */
export async function generateTitle(userMessage: string): Promise<string> {
  const response = await chat(
    [
      {
        role: "system",
        content:
          "Generate a very short title (3-5 words max) for this conversation. Reply with ONLY the title, nothing else.",
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    { temperature: 0.3 }
  );

  // Clean up the response
  return response.trim().replace(/^["']|["']$/g, "").slice(0, 50);
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List available models
 */
export async function listModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) return [];

    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch {
    return [];
  }
}

/**
 * Create SSE stream for Hono response
 */
export function createSSEStream(
  messages: ChatMessage[],
  options: ChatOptions = {}
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        let fullContent = "";

        for await (const chunk of streamChat(messages, options)) {
          fullContent += chunk;

          // Send SSE event
          const event = `data: ${JSON.stringify({ content: chunk, done: false })}\n\n`;
          controller.enqueue(encoder.encode(event));
        }

        // Send completion event
        const doneEvent = `data: ${JSON.stringify({ content: "", done: true, fullContent })}\n\n`;
        controller.enqueue(encoder.encode(doneEvent));

        controller.close();
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({ error: String(error), done: true })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
  });
}
