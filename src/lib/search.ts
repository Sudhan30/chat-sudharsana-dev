/**
 * Brave Search API Integration
 * Provides web search capabilities for the AI assistant
 */

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface SearchResult {
    title: string;
    url: string;
    description: string;
}

export interface BraveSearchResponse {
    query: { original: string };
    web: {
        results: Array<{
            title: string;
            url: string;
            description: string;
            extra_snippets?: string[];
        }>;
    };
}

/**
 * Perform a web search using Brave Search API
 */
export async function searchWeb(query: string, count = 5): Promise<SearchResult[]> {
    if (!BRAVE_API_KEY) {
        console.warn("Brave Search API key not configured");
        return [];
    }

    try {
        const params = new URLSearchParams({
            q: query,
            count: count.toString(),
            text_decorations: "false",
            search_lang: "en",
        });

        const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": BRAVE_API_KEY,
            },
        });

        if (!response.ok) {
            console.error(`Brave Search error: ${response.status}`);
            return [];
        }

        const data: BraveSearchResponse = await response.json();

        return (data.web?.results || []).slice(0, count).map((r) => ({
            title: r.title,
            url: r.url,
            description: r.description,
        }));
    } catch (error) {
        console.error("Search failed:", error);
        return [];
    }
}

/**
 * Format search results as context for the AI
 */
export function formatSearchContext(results: SearchResult[]): string {
    if (results.length === 0) return "";

    const formatted = results
        .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.description}`)
        .join("\n\n");

    return `\n\n--- Web Search Results ---\n${formatted}\n--- End Search Results ---\n`;
}

/**
 * Determine if a query likely needs web search
 * Returns true for queries about current events, weather, news, prices, etc.
 */
export function shouldSearchWeb(message: string): boolean {
    const lowerMsg = message.toLowerCase();

    // Keywords that suggest need for current information
    const searchTriggers = [
        "today",
        "current",
        "latest",
        "recent",
        "now",
        "weather",
        "news",
        "price",
        "stock",
        "what time",
        "when is",
        "where is",
        "how to get to",
        "directions",
        "search for",
        "look up",
        "find me",
        "what's happening",
        "score",
        "results",
        "who won",
        "release date",
        "opening hours",
        "nearby",
        "restaurant",
        "store",
        "movie",
        "show",
    ];

    // Time-sensitive question patterns
    const timePatterns = [
        /what('s| is) the .*(today|now|current)/i,
        /how (much|many) .*(cost|price)/i,
        /when (does|did|will|is)/i,
        /is .* open/i,
    ];

    // Check triggers
    for (const trigger of searchTriggers) {
        if (lowerMsg.includes(trigger)) return true;
    }

    // Check patterns
    for (const pattern of timePatterns) {
        if (pattern.test(message)) return true;
    }

    return false;
}

/**
 * Health check for Brave Search API
 */
export async function checkSearchHealth(): Promise<boolean> {
    if (!BRAVE_API_KEY) return false;

    try {
        const results = await searchWeb("test", 1);
        return results.length > 0;
    } catch {
        return false;
    }
}
