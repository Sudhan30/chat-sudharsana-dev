/**
 * Data Agent - Text-to-SQL and web search via tool calling
 * Gemma3 decides when to query databases or search the web
 */

import postgres from "postgres";
import { searchWeb, formatSearchContext } from "./search";

// ============================================
// Schema Context for System Prompt
// ============================================

export const SCHEMA_CONTEXT = `
## Available Databases

### BLOG_DB (blog.sudharsana.dev)
Tables:
- comments(id, post_id, content, author_name, author_email, created_at, approved, client_id)
- likes(id, post_id, client_id, ip_hash, created_at)
- comment_summaries(id, post_id, summary_text, comment_count, last_comment_id, updated_at)

### TRADING_DB (algo trading system)
Tables:
- trades(id, symbol, quantity, entry_price, exit_price, pnl, pnl_pct, strategy, entry_strategy, exit_strategy, entry_time, exit_time, hold_duration, commission)
- orders(id, order_id, symbol, side, type, quantity, filled_quantity, price, filled_avg_price, status, strategy, created_at, filled_at)
- positions(id, symbol, quantity, avg_entry_price, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, strategy, opened_at)
- portfolio_snapshots(time, total_value, cash, positions_value, daily_pnl, daily_pnl_pct, total_pnl, total_pnl_pct, num_positions, num_trades_today) -- TimescaleDB hypertable
- strategy_performance(id, strategy, period, start_time, end_time, total_trades, winning_trades, losing_trades, win_rate, total_pnl, avg_win, avg_loss, profit_factor, sharpe_ratio, max_drawdown)
- signals(id, time, symbol, strategy, signal, strength, price, indicators JSONB, executed, rejection_reason) -- hypertable
- market_data(time, symbol, open, high, low, close, volume, vwap, trade_count, timeframe) -- hypertable, 1-min OHLCV bars
- stock_universe(symbol, company_name, market_cap, sector, industry, is_active, is_mandatory)
- news_articles(id, time, symbol, headline, summary, source, sentiment_score, category, relevance_score) -- hypertable
- research_reports(id, time, report_type, title, content, symbols[], metadata JSONB) -- hypertable
- day_trades(id, trade_date, symbol, buy_time, sell_time, is_day_trade)
- backtest_runs(id, start_date, end_date, symbols[], initial_cash, final_equity, total_return_pct, total_trades, win_rate, profit_factor, sharpe_ratio, config_snapshot JSONB)
- backtest_trades(id, run_id, symbol, side, entry_price, exit_price, pnl, pnl_pct, strategy, exit_reason)

Continuous aggregates: market_data_5min, market_data_15min (bucket, symbol, open, high, low, close, volume)

Notes:
- Use time_bucket('1 day', time) for time grouping on hypertables
- All timestamps are TIMESTAMPTZ (UTC)
- Prices use DECIMAL precision
- portfolio_snapshots has daily snapshots of account state
`;

// ============================================
// SQL Example Hints
// ============================================

export const SQL_EXAMPLES = `
SQL EXAMPLES:
- Today's trades: SELECT symbol, pnl, pnl_pct, strategy, entry_time, exit_time FROM trades WHERE exit_time::date = CURRENT_DATE ORDER BY exit_time DESC
- Weekly P&L: SELECT SUM(pnl) as total_pnl, COUNT(*) as num_trades FROM trades WHERE exit_time >= NOW() - INTERVAL '7 days'
- Blog comments today: SELECT COUNT(*) FROM comments WHERE created_at::date = CURRENT_DATE
- Total blog likes: SELECT COUNT(*) FROM likes
- Portfolio value: SELECT * FROM portfolio_snapshots ORDER BY time DESC LIMIT 1
- Best strategy: SELECT strategy, SUM(pnl) as total_pnl, COUNT(*) as trades, ROUND(AVG(pnl_pct)::numeric, 2) as avg_pnl_pct FROM trades GROUP BY strategy ORDER BY total_pnl DESC
- Open positions: SELECT symbol, quantity, unrealized_pnl, unrealized_pnl_pct FROM positions ORDER BY unrealized_pnl DESC
- Recent signals: SELECT symbol, strategy, signal, strength, price FROM signals WHERE time >= NOW() - INTERVAL '1 day' ORDER BY time DESC LIMIT 20
- Market data: SELECT time_bucket('1 day', time) as day, symbol, AVG(close) as avg_close FROM market_data WHERE symbol = 'AAPL' AND time >= NOW() - INTERVAL '7 days' GROUP BY day, symbol ORDER BY day
- Comments per post: SELECT post_id, COUNT(*) as comment_count FROM comments WHERE approved = true GROUP BY post_id ORDER BY comment_count DESC LIMIT 10
`;

// ============================================
// Tool Definitions (Ollama-compatible)
// ============================================

export const DATA_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "query_blog_db",
      description:
        "Execute a read-only SQL query against the blog database. Contains tables: comments, likes, comment_summaries.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A SELECT SQL query to run against the blog database",
          },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_trading_db",
      description:
        "Execute a read-only SQL query against the trading database. Contains tables: trades, orders, positions, portfolio_snapshots, strategy_performance, signals, market_data, stock_universe, news_articles, research_reports, day_trades, backtest_runs, backtest_trades.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description:
              "A SELECT SQL query to run against the trading database",
          },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the web for current information. Use this for questions about weather, news, current events, prices, release dates, sports scores, or anything that requires up-to-date information from the internet. Do NOT use this for questions about the user's own data (blog, trades, etc.) — use the database query tools instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query to look up on the web",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_k8s_pods",
      description:
        "Query Kubernetes pod status from the suddu-server K3s cluster. Returns pod name, namespace, phase (Running/Pending/Failed/Succeeded), ready count, restart count, and age. Use this when the user asks about: pods, cluster health, what's running, service status, 'is X running', node status, infrastructure state, or any Kubernetes-related question.",
      parameters: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description:
              "Kubernetes namespace to filter by. Use 'all' for all namespaces. Common values: 'web' (blog/chat/backend), 'trading' (trading system), 'monitoring', 'flux-system'.",
          },
        },
        required: ["namespace"],
      },
    },
  },
];

// ============================================
// Read-Only Database Connections
// ============================================

const BLOG_DB_URL =
  process.env.BLOG_DB_READONLY_URL ||
  "postgresql://readonly_agent:R3adOnly_Ag3nt_S3cur3_2026@postgres-service:5432/blog_db";

const TRADING_DB_URL =
  process.env.TRADING_DB_READONLY_URL ||
  "postgresql://readonly_agent:R3adOnly_Ag3nt_S3cur3_2026@timescaledb.trading.svc.cluster.local:5432/trading_db";

let blogDb: ReturnType<typeof postgres> | null = null;
let tradingDb: ReturnType<typeof postgres> | null = null;

function getBlogDb() {
  if (!blogDb) {
    blogDb = postgres(BLOG_DB_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 5,
    });
  }
  return blogDb;
}

function getTradingDb() {
  if (!tradingDb) {
    tradingDb = postgres(TRADING_DB_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 5,
    });
  }
  return tradingDb;
}

// ============================================
// SQL Validation
// ============================================

export function validateSQL(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().replace(/;+$/, "");

  // Must be a SELECT or WITH (CTE)
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    return { valid: false, error: "Only SELECT queries are allowed" };
  }

  // Block dangerous keywords
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|DO\s*\$)\b/i;
  if (forbidden.test(trimmed)) {
    return { valid: false, error: "Query contains forbidden operations" };
  }

  return { valid: true };
}

// ============================================
// Query Execution
// ============================================

export interface QueryResult {
  success: boolean;
  data?: Record<string, unknown>[];
  error?: string;
  rowCount?: number;
}

export async function executeAgentQuery(
  database: "blog" | "trading",
  sqlQuery: string
): Promise<QueryResult> {
  const validation = validateSQL(sqlQuery);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Clean and limit query
  let query = sqlQuery.trim().replace(/;+$/, "");
  if (!/\bLIMIT\b/i.test(query)) {
    query += " LIMIT 100";
  }

  const db = database === "blog" ? getBlogDb() : getTradingDb();

  try {
    const result = await db.unsafe(query);
    return {
      success: true,
      data: result as Record<string, unknown>[],
      rowCount: result.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Agent query error (${database}):`, message);
    return { success: false, error: message };
  }
}

// ============================================
// Tool Call Handler
// ============================================

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  locationContext?: { city?: string; country?: string }
): Promise<QueryResult> {
  if (toolName === "search_web") {
    const query = args.query as string;
    if (!query) {
      return { success: false, error: "No search query provided" };
    }

    try {
      const results = await searchWeb(query, 5, locationContext);
      if (results.length === 0) {
        return { success: true, data: [{ message: "No search results found" }], rowCount: 0 };
      }
      const formatted = results.map((r, i) => ({
        position: i + 1,
        title: r.title,
        url: r.url,
        description: r.description,
      }));
      return { success: true, data: formatted, rowCount: results.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  if (toolName === "get_k8s_pods") {
    const namespace = (args.namespace as string) || "all";
    return getK8sPods(namespace);
  }

  const sql = args.sql as string;
  if (!sql) {
    return { success: false, error: "No SQL query provided" };
  }

  if (toolName === "query_blog_db") {
    return executeAgentQuery("blog", sql);
  } else if (toolName === "query_trading_db") {
    return executeAgentQuery("trading", sql);
  }

  return { success: false, error: `Unknown tool: ${toolName}` };
}

// ============================================
// Kubernetes Tool
// ============================================
// Uses the in-cluster ServiceAccount credentials to read pod status.
// Requires: deployment uses a SA bound to a ClusterRole with pods get/list.

const K8S_API = "https://kubernetes.default.svc";
const K8S_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const K8S_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

interface K8sPod {
  metadata: { name: string; namespace: string; creationTimestamp: string };
  spec: { containers: Array<{ name: string }> };
  status: {
    phase: string;
    startTime?: string;
    containerStatuses?: Array<{ ready: boolean; restartCount: number }>;
  };
}

async function getK8sPods(namespace: string): Promise<QueryResult> {
  let token: string;
  let ca: string;
  try {
    token = await Bun.file(K8S_TOKEN_PATH).text();
    ca = await Bun.file(K8S_CA_PATH).text();
  } catch {
    return {
      success: false,
      error: "Kubernetes service account token not mounted. Chat pod may not have RBAC configured.",
    };
  }

  const url =
    namespace === "all"
      ? `${K8S_API}/api/v1/pods`
      : `${K8S_API}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      tls: { ca } as any,
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `Kubernetes API returned ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as { items: K8sPod[] };
    const now = Date.now();
    const rows = data.items.map((p) => {
      const containerStatuses = p.status.containerStatuses || [];
      const readyCount = containerStatuses.filter((c) => c.ready).length;
      const totalContainers = p.spec.containers?.length ?? 0;
      const restartCount = containerStatuses.reduce((a, c) => a + c.restartCount, 0);
      const startTime = p.status.startTime || p.metadata.creationTimestamp;
      const ageSeconds = Math.floor((now - new Date(startTime).getTime()) / 1000);
      const ageHuman = formatAge(ageSeconds);
      return {
        namespace: p.metadata.namespace,
        name: p.metadata.name,
        phase: p.status.phase,
        ready: `${readyCount}/${totalContainers}`,
        restarts: restartCount,
        age: ageHuman,
      };
    });

    return { success: true, data: rows, rowCount: rows.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Kubernetes fetch failed: ${message}` };
  }
}

function formatAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ============================================
// Health Check
// ============================================

export async function checkAgentDbHealth(): Promise<{
  blogDb: boolean;
  tradingDb: boolean;
}> {
  let blogOk = false;
  let tradingOk = false;

  try {
    await getBlogDb()`SELECT 1`;
    blogOk = true;
  } catch {}

  try {
    await getTradingDb()`SELECT 1`;
    tradingOk = true;
  } catch {}

  return { blogDb: blogOk, tradingDb: tradingOk };
}

// ============================================
// Graceful Shutdown
// ============================================

export async function closeAgentConnections(): Promise<void> {
  if (blogDb) await blogDb.end();
  if (tradingDb) await tradingDb.end();
}
