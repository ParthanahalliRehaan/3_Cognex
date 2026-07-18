-- ============================================================================
-- 002_bridge_migration.sql — Bridge old schema → improved schema
-- Run this in Supabase SQL Editor AFTER the original 001_init.sql
-- Safe to re-run (all statements use IF NOT EXISTS)
-- ============================================================================

-- ─── 1. Fix graph_edges metadata column ──────────────────────────────────────

-- Add metadata column if missing (your old schema doesn't have it)
ALTER TABLE graph_edges
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add GIN index for metadata queries
CREATE INDEX IF NOT EXISTS idx_graph_edges_metadata
ON graph_edges USING GIN (metadata);

-- ─── 2. Update match_documents function signature ────────────────────────────

-- Drop the old 3-param version (safe: no data loss, just a function)
DROP FUNCTION IF EXISTS match_documents(vector(1024), float, int);

-- Create the new 4-param version that the improved backend expects
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding VECTOR(1024),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  filter_repo_url TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  repo_url TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    d.id,
    d.repo_url,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE
    (filter_repo_url IS NULL OR d.repo_url = filter_repo_url)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─── 3. Add performance indexes (missing from original schema) ───────────────

-- Documents table
CREATE INDEX IF NOT EXISTS idx_documents_repo ON documents(repo_url);
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

-- HNSW index for FAST vector similarity (much faster than default ivfflat)
-- Only create if not exists; HNSW is the gold standard for pgvector
CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw
ON documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Graph nodes
CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo ON graph_nodes(repo_url);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_label ON graph_nodes(label);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo_type ON graph_nodes(repo_url, node_type);

-- Graph edges
CREATE INDEX IF NOT EXISTS idx_graph_edges_repo ON graph_edges(repo_url);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation);
CREATE INDEX IF NOT EXISTS idx_graph_edges_repo_relation ON graph_edges(repo_url, relation);

-- ─── 4. Add helpful views ────────────────────────────────────────────────────

-- Repo stats view (for the /api/stats endpoint)
CREATE OR REPLACE VIEW public.repo_stats WITH (security_invoker = on) AS
SELECT
  COALESCE(gn.repo_url, d.repo_url) AS repo_url,
  COUNT(DISTINCT gn.id) AS node_count,
  COUNT(DISTINCT ge.id) AS edge_count,
  COUNT(DISTINCT d.id) AS doc_count,
  MAX(COALESCE(gn.created_at, d.created_at, NOW())) AS last_ingested
FROM (
  SELECT DISTINCT graph_nodes.repo_url FROM graph_nodes
  UNION
  SELECT DISTINCT documents.repo_url FROM documents
) repos
LEFT JOIN graph_nodes gn ON gn.repo_url = repos.repo_url
LEFT JOIN graph_edges ge ON ge.repo_url = repos.repo_url
LEFT JOIN documents d ON d.repo_url = repos.repo_url
GROUP BY COALESCE(gn.repo_url, d.repo_url);

-- ─── 5. Verify everything is correct ─────────────────────────────────────────

-- Uncomment to verify:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'graph_edges';

-- Uncomment to test the function:
-- SELECT * FROM match_documents(
--   (SELECT embedding FROM documents LIMIT 1),
--   0.5, 5, 'https://github.com/owner/repo'
-- );