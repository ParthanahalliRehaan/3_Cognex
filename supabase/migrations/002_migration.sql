-- Migration: Fix graph_edges metadata column
-- Run this in Supabase SQL Editor if you get "Could not find the 'metadata' column" error

-- Add metadata column to graph_edges if it doesn't exist
ALTER TABLE graph_edges 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Create index for metadata queries
CREATE INDEX IF NOT EXISTS idx_graph_edges_metadata 
ON graph_edges USING GIN (metadata);

-- Also ensure graph_nodes has proper indexes
CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo_type 
ON graph_nodes (repo_url, node_type);

CREATE INDEX IF NOT EXISTS idx_graph_edges_repo_relation 
ON graph_edges (repo_url, relation);