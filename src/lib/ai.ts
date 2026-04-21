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
const CHAT_MODEL = process.env.OLLAMA_MODEL || "gemma4:latest";

// Standard text-only message. `tool_calls` / tool role used with native tool calling.
export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
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
  const model = options.model || CHAT_MODEL;

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
      keep_alive: options.keep_alive ?? "30m",
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
  const model = options.model || CHAT_MODEL;

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
      keep_alive: options.keep_alive ?? "30m",
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
  const model = options.model || CHAT_MODEL;

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
      keep_alive: options.keep_alive ?? "30m",
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
// Native Tool Calling (Gemma4 / single-model)
// Gemma4 has native function calling, so the same model
// detects intent, calls tools, and formats results.
// ============================================

export interface AgentStreamEvent {
  type: "text" | "status" | "tool_result";
  content: string;
}

function statusLabelFor(fnName: string): string {
  if (fnName === "search_web") return "Searching the web...";
  if (fnName === "query_blog_db") return "Querying blog database...";
  if (fnName === "query_trading_db") return "Querying trading database...";
  return `Running ${fnName}...`;
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

/**
 * Chat with native tool calling. Loops up to MAX_TOOL_ROUNDS times:
 * 1. Ask model for a response (with tools available).
 * 2. If model emits tool_calls, execute them and feed results back.
 * 3. Otherwise, yield the final text and return.
 */
export async function* chatWithTools(
  messages: ChatMessage[],
  options: ChatOptions = {},
  locationContext?: { city?: string; country?: string }
): AsyncGenerator<AgentStreamEvent, void, unknown> {
  const model = options.model || CHAT_MODEL;
  const MAX_TOOL_ROUNDS = 3;
  const current: ChatMessage[] = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolResponse = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: current,
        tools: DATA_AGENT_TOOLS,
        stream: false,
        think: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_ctx: options.num_ctx ?? 16384,
        },
        keep_alive: options.keep_alive ?? "30m",
      }),
    });

    if (!toolResponse.ok) {
      throw new Error(`Ollama error: ${toolResponse.status} ${toolResponse.statusText}`);
    }

    const data = await toolResponse.json();
    const toolCalls: OllamaToolCall[] | undefined = data.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      // Preserve tool_calls on the assistant message — Ollama needs them in
      // the history to pair the upcoming tool responses with their calls.
      current.push({
        role: "assistant",
        content: data.message.content || "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        const args = tc.function.arguments;

        yield { type: "status", content: statusLabelFor(fnName) };
        console.log(`[Agent] Tool call: ${fnName}`, JSON.stringify(args));

        const result: QueryResult = await handleToolCall(fnName, args, locationContext);
        yield { type: "tool_result", content: JSON.stringify(result) };

        console.log(
          `[Agent] Tool result: ${result.success ? result.rowCount + " rows" : result.error}`
        );

        current.push({
          role: "tool",
          content: JSON.stringify(result.success ? result.data : { error: result.error }),
        });
      }

      // After tools resolve, stream the formatted answer so the user sees
      // tokens arrive incrementally instead of waiting on a big non-streaming
      // response. Skip round 2's non-streaming call entirely for this branch.
      yield { type: "status", content: "Formatting results..." };
      for await (const chunk of streamChat(current, {
        ...options,
        model,
        num_ctx: options.num_ctx ?? 16384,
        temperature: options.temperature ?? 0.5,
      })) {
        yield { type: "text", content: chunk };
      }
      return;
    }

    if (data.message?.content) {
      yield { type: "text", content: data.message.content };
    }
    return;
  }

  // Exhausted rounds — stream whatever the model can say now.
  for await (const chunk of streamChat(current, { ...options, model })) {
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
You have access to three tools via native function calling. Call them directly when the user asks a question that requires real data — do NOT answer from your own knowledge.

Available tools:
- query_blog_db — Query the blog database (tables: comments, likes, comment_summaries)
- query_trading_db — Query the trading database (tables: trades, orders, positions, portfolio_snapshots, strategy_performance, signals, market_data, stock_universe, news_articles, research_reports, day_trades, backtest_runs, backtest_trades)
- search_web — Search the web for current info (weather, news, prices, events)

When to call a tool:
- Blog comments / likes / posts / visitors → query_blog_db
- Trades, P&L, profit, loss, positions, portfolio, orders, signals, strategies, market data, stocks → query_trading_db
- Weather, news, current events, prices, sports scores, release dates → search_web
- General knowledge, conversation, explanations, creative tasks → answer directly, no tool

SQL rules:
- Only SELECT queries. Never INSERT/UPDATE/DELETE/DROP.
- Always include appropriate WHERE clauses and LIMITs.
- Use CURRENT_DATE, NOW(), and INTERVAL for date math. All timestamps are UTC.
- For TimescaleDB hypertables, use time_bucket() for time-based grouping.

IMPORTANT — NEVER ask a clarifying question on a data request. If the user asks about "my trades", "my positions", "my P&L", "my blog comments", etc., call the appropriate tool immediately with a reasonable default (e.g. 10 most recent rows, or current open positions, or today's data). If the user's intent is genuinely ambiguous, make your best guess, show the results, and THEN offer to refine. Showing data beats asking questions.

After receiving tool results, present them clearly using markdown tables or bullet points. Include relevant numbers, percentages, and context.

${SCHEMA_CONTEXT}
${SQL_EXAMPLES}`;
  }

  return prompt;
}

