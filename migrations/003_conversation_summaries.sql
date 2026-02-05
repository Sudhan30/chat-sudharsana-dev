-- Migration: Add conversation summaries table
-- This enables token-efficient context management through summarization

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary_type VARCHAR(20) NOT NULL CHECK (summary_type IN ('detailed', 'high_level')),
  message_range_start INTEGER NOT NULL,
  message_range_end INTEGER NOT NULL,
  summary_text TEXT NOT NULL,
  token_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, summary_type)
);

CREATE INDEX IF NOT EXISTS idx_summaries_session ON conversation_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_summaries_type ON conversation_summaries(session_id, summary_type);

COMMENT ON TABLE conversation_summaries IS 'Stores conversation summaries for efficient context management';
COMMENT ON COLUMN conversation_summaries.summary_type IS 'Type of summary: detailed (10-50 msgs) or high_level (50+ msgs)';
COMMENT ON COLUMN conversation_summaries.message_range_start IS 'First message index included in summary (1-indexed)';
COMMENT ON COLUMN conversation_summaries.message_range_end IS 'Last message index included in summary (1-indexed)';
