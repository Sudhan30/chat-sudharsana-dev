/**
 * Conversation Summarization Module
 * 
 * Implements rolling summarization to reduce token usage and enable
 * infinite-length conversations by compressing older messages.
 */

import { streamChat } from "./ai";

export interface ConversationSummary {
    id: string;
    session_id: string;
    summary_type: "detailed" | "high_level";
    message_range_start: number;
    message_range_end: number;
    summary_text: string;
    token_count: number | null;
    created_at: Date;
    updated_at: Date;
}

export interface MessageForSummarization {
    role: string;
    content: string;
    created_at: Date;
}

/**
 * Check if summarization should be triggered for a session
 */
export function shouldTriggerSummarization(messageCount: number): boolean {
    // Trigger every 10 messages after the first 10
    return messageCount > 10 && messageCount % 10 === 0;
}

/**
 * Determine which type of summary to create based on message count
 */
export function getSummaryType(messageCount: number): "detailed" | "high_level" | null {
    if (messageCount >= 50) {
        return "high_level"; // For messages 50+
    } else if (messageCount >= 10) {
        return "detailed"; // For messages 10-49
    }
    return null;
}

/**
 * Generate a conversation summary using Gemma
 */
export async function generateSummary(
    messages: MessageForSummarization[],
    summaryType: "detailed" | "high_level"
): Promise<string> {
    const wordLimit = summaryType === "detailed" ? 150 : 100;

    const prompt = getSummarizationPrompt(messages, wordLimit);

    let summary = "";
    for await (const chunk of streamChat([
        {
            role: "system",
            content: "You are an expert at creating concise, information-dense conversation summaries."
        },
        {
            role: "user",
            content: prompt
        }
    ])) {
        summary += chunk;
    }

    return summary.trim();
}

/**
 * Build the summarization prompt
 */
function getSummarizationPrompt(
    messages: MessageForSummarization[],
    wordLimit: number
): string {
    const conversationText = messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

    return `You are creating a conversation summary for context preservation in a chat application.

**PRESERVE:**
- Key facts, decisions, and action items
- User preferences, settings, and personal context
- Important technical details or data
- Unresolved questions or ongoing topics
- Specific names, dates, numbers, or identifiers

**OMIT:**
- Greetings, pleasantries, casual chat
- Redundant or repeated information
- Fully resolved topics with no remaining relevance
- Tangential discussions

**FORMAT:** Concise bullet points, maximum ${wordLimit} words.

**Conversation to summarize:**
${conversationText}

**Summary:**`;
}

/**
 * Estimate token count for a text
 * Uses rough heuristic: 1 token ≈ 4 characters
 */
export function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}
