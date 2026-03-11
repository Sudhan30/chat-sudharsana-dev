/**
 * Ollama AI Integration with Streaming Support
 * Supports multimodal (vision), text generation, and tool calling
 */

import {
  SCHEMA_CONTEXT,
  SQL_EXAMPLES,
  DATA_AGENT_TOOLS,
  handleToolCall,
  type QueryResult,
} from "./agent";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma:latest";

// Standard text-only message
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Multimodal message with optional image(s)
export interface MultimodalMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[]; // Base64-encoded images
}

// Location context from browser geolocation
export interface LocationContext {
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
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

/**
 * Stream chat with vision support (multimodal)
 * Handles messages that may contain images
 */
export async function* streamChatWithVision(
  messages: MultimodalMessage[],
  options: ChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const model = options.model || DEFAULT_MODEL;

  // Convert multimodal messages to Ollama format
  const ollamaMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    ...(msg.images && msg.images.length > 0 ? { images: msg.images } : {}),
  }));

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: ollamaMessages,
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

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

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
          console.error("Failed to parse Ollama chunk:", line);
        }
      }
    }

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

// ============================================
// Tool Call Types
// ============================================

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaToolResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export interface AgentStreamEvent {
  type: "text" | "status" | "tool_result";
  content: string;
}

/**
 * Chat with tool calling support for data agent
 * Makes a non-streaming call first to check for tool calls,
 * then streams the final response
 */
export async function* chatWithTools(
  messages: ChatMessage[],
  options: ChatOptions = {},
  locationContext?: { city?: string; country?: string }
): AsyncGenerator<AgentStreamEvent, void, unknown> {
  const model = options.model || DEFAULT_MODEL;
  const MAX_TOOL_ROUNDS = 3;

  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Non-streaming call to check for tool calls
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: currentMessages,
        tools: DATA_AGENT_TOOLS,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_ctx: options.num_ctx ?? 8192,
        },
        keep_alive: options.keep_alive ?? "5m",
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data: OllamaToolResponse = await response.json();

    // Check if model wants to call tools
    if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
      // Add assistant's tool call message to history
      currentMessages.push({
        role: "assistant",
        content: data.message.content || "",
      });

      for (const toolCall of data.message.tool_calls) {
        const fnName = toolCall.function.name;
        const args = toolCall.function.arguments;

        const statusLabel =
          fnName === "search_web"
            ? "Searching the web..."
            : fnName === "query_blog_db"
              ? "Querying blog database..."
              : "Querying trading database...";

        yield { type: "status", content: statusLabel };

        console.log(`[Agent] Tool call: ${fnName}`, JSON.stringify(args));

        const result: QueryResult = await handleToolCall(fnName, args, locationContext);

        yield {
          type: "tool_result",
          content: JSON.stringify(result),
        };

        console.log(
          `[Agent] Tool result: ${result.success ? result.rowCount + " rows" : result.error}`
        );

        // Add tool result to messages
        currentMessages.push({
          role: "tool" as any,
          content: JSON.stringify(
            result.success ? result.data : { error: result.error }
          ),
        });
      }

      // Continue loop - model may need another tool call or will give final answer
      continue;
    }

    // No tool calls - stream the final response
    if (data.message?.content) {
      // Model already gave a complete response in non-streaming mode
      // Yield it as text chunks for consistent streaming UX
      yield { type: "text", content: data.message.content };
      return;
    }

    // Fallback: stream normally if no content in tool response
    for await (const chunk of streamChat(currentMessages, options)) {
      yield { type: "text", content: chunk };
    }
    return;
  }

  // If we exhausted tool rounds, stream a final response
  for await (const chunk of streamChat(currentMessages, options)) {
    yield { type: "text", content: chunk };
  }
}

/**
 * Build enhanced system prompt with location and capabilities
 */
export function buildSystemPrompt(
  userName: string,
  location?: LocationContext,
  hasSearchEnabled = true,
  hasDataAgent = true
): string {
  // Get current date in a clear format
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  let prompt = `You are a helpful, intelligent AI assistant. Be concise, accurate, and friendly. The user's name is ${userName}. Do not greet the user by name in every message - only use their name when it's contextually appropriate.

CURRENT DATE AND TIME: ${dateStr} at ${timeStr}
This is the ACTUAL current date. Always use this date when asked about today's date, current day, or anything time-related. Do NOT make up or guess dates.`;

  if (location) {
    const cityInfo = location.city ? location.city : "Unknown city";
    const countryInfo = location.country ? location.country : "Unknown country";
    prompt += `

USER'S LOCATION: ${cityInfo}, ${countryInfo}
Coordinates: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}

IMPORTANT: When the user asks about weather, local businesses, nearby places, or anything location-specific, use THIS location (${cityInfo}, ${countryInfo}) - NOT any other location. The user is physically located here right now.`;
  }

  if (hasSearchEnabled) {
    prompt += `

WEB SEARCH: You have access to a search_web tool. Use it when the user asks about current events, weather, news, prices, sports scores, release dates, or anything requiring up-to-date information from the internet. Do NOT use it for questions about the user's own data — use the database query tools instead.`;
  }

  prompt += `

IMAGE ANALYSIS: You can analyze images. If the user sends an image, describe what you see in detail.

RESPONSE FORMAT:
- Use markdown: **bold**, *italic*, bullet lists, and code blocks
- Keep responses concise and well-structured
- Use single blank lines between paragraphs (never multiple blank lines)
- Do NOT include raw URLs or markdown links like [text](url)
- Do NOT add extra blank lines before or after lists
- Start responses directly with content (no greeting every time)`;

  if (hasDataAgent) {
    prompt += `

DATA AGENT CAPABILITIES:
You have access to query two databases using SQL tools. When the user asks about blog stats, comments, likes, trades, P&L, positions, portfolio, market data, strategies, or any data question, use the appropriate query tool.
Write precise, correct SQL. Only use SELECT queries. For TimescaleDB hypertables, use time_bucket() for time-based grouping. All timestamps are in UTC.
When you receive query results, present them in a clear, human-friendly format using markdown tables or bullet points. Include relevant numbers, percentages, and context.
${SCHEMA_CONTEXT}
${SQL_EXAMPLES}`;
  }

  return prompt;
}

