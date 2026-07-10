-- Enable the vector extension for pgvector
create extension if not exists vector;

-- Table: documents
-- Stores chunks of text (README, code, issues) with their embeddings
create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    repo_url text not null,
    content text not null,
    metadata jsonb default '{}',
    embedding vector(1024)  -- BAAI/bge-large-en-v1.5 outputs 1024 dimensions
);

-- Table: graph_nodes
-- Stores entities: files, functions, contributors, issues, PRs, commits
create table if not exists graph_nodes (
    id uuid primary key default gen_random_uuid(),
    repo_url text not null,
    node_type text not null,  -- 'file', 'function', 'contributor', 'issue', 'pr', 'commit', 'dependency'
    label text not null,
    metadata jsonb default '{}'
);

-- Table: graph_edges
-- Stores relationships between nodes
create table if not exists graph_edges (
    id uuid primary key default gen_random_uuid(),
    repo_url text not null,
    source_node_id uuid references graph_nodes(id) on delete cascade,
    target_node_id uuid references graph_nodes(id) on delete cascade,
    relation text not null  -- 'contains', 'authored', 'modifies', 'references', 'fixes', 'depends_on', 'opened'
);

-- Function: match_documents
-- Performs cosine similarity search on embeddings
create or replace function match_documents(
    query_embedding vector(1024),
    match_threshold float,
    match_count int
)
returns table (
    id uuid,
    repo_url text,
    content text,
    metadata jsonb,
    similarity float
)
language sql stable
as $$
    select
        id,
        repo_url,
        content,
        metadata,
        1 - (embedding <=> query_embedding) as similarity
    from documents
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by embedding <=> query_embedding
    limit match_count;
$$;