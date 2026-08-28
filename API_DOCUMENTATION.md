# Cognex API Documentation

> **Version:** 1.2.0  
> **Base URL:** `https://cognex-worker.your-subdomain.workers.dev`  
> **Deployed Frontend:** `https://cognex-5ij.pages.dev/`  

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Health & Status](#health--status)
4. [CRUD — Graph Nodes](#crud--graph-nodes)
5. [CRUD — Graph Edges](#crud--graph-edges)
6. [CRUD — Documents](#crud--documents)
7. [Application Routes](#application-routes)
8. [Error Handling](#error-handling)
9. [Rate Limits](#rate-limits)

---

## Overview

Cognex is a cloud-based Knowledge Graph & Doubt Resolution Engine for GitHub repositories. The backend exposes a RESTful API built on **Cloudflare Workers** using the **Hono** framework. All responses are JSON (except streaming endpoints). Every response includes a unique `requestId` for tracing.

### HTTP Methods Used

| Method | Purpose |
|--------|---------|
| `GET` | Retrieve resources |
| `POST` | Create resources / Trigger actions |
| `PUT` | Update resources (full replacement) |
| `DELETE` | Remove resources |
| `OPTIONS` | CORS preflight |

### Response Format

```json
{
  "success": true,
  "data": { ... },
  "requestId": "a1b2c3d4"
}
```

Error responses:

```json
{
  "error": "Human-readable message",
  "requestId": "a1b2c3d4"
}
```

---

## Authentication

The API does not use token-based auth for public endpoints. CORS is configured to allow all origins. Sensitive operations rely on **Cloudflare Worker secrets** (Supabase keys, Groq API key, GitHub token) stored via `wrangler secret put`.

---

## Health & Status

### `GET /health`

Returns the health status of the worker and its dependencies.

**Response (200 OK):**

```json
{
  "status": "ok",
  "service": "cognex-worker",
  "version": "1.2.0",
  "timestamp": "2026-08-28T08:30:00.000Z",
  "env": {
    "hasSupabaseUrl": true,
    "hasGroqKey": true,
    "hasGithubToken": true,
    "hasCohereKey": true,
    "hasSearchKey": true
  }
}
```

---

## CRUD — Graph Nodes

Graph nodes represent entities in a repository: files, functions, contributors, issues, PRs, commits, dependencies, and the repo itself.

### `POST /api/nodes` — Create Node

Creates a single graph node.

**Request Body:**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "node_type": "file",
  "label": "src/index.js",
  "metadata": {
    "path": "src/index.js",
    "extension": "js",
    "size": 4200
  }
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "repo_url": "https://github.com/owner/repo",
    "node_type": "file",
    "label": "src/index.js",
    "metadata": { "path": "src/index.js", "extension": "js", "size": 4200 },
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

**Validation Rules:**
- `repo_url` must be a valid GitHub URL.
- `node_type` is required (string, max 50 chars).
- `label` is required (string, max 500 chars).
- `metadata` is optional (JSON object).

---

### `GET /api/nodes` — List Nodes

Retrieves all graph nodes for a repository, optionally filtered by `nodeType`.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |
| `nodeType` | string | No | Filter by node type (e.g., `file`, `contributor`) |

**Example:** `GET /api/nodes?repoUrl=https://github.com/vercel/next.js&nodeType=file`

**Response (200 OK):**

```json
{
  "success": true,
  "count": 42,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "repo_url": "https://github.com/vercel/next.js",
      "node_type": "file",
      "label": "packages/next/src/server/next.ts",
      "metadata": { "extension": "ts", "category": "source" },
      "created_at": "2026-08-28T08:30:00.000Z"
    }
  ],
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/nodes/:id` — Get Single Node

Retrieves a specific node by its UUID.

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "repo_url": "https://github.com/owner/repo",
    "node_type": "contributor",
    "label": "octocat",
    "metadata": { "contributions": 150, "avatar_url": "..." },
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

**Error (404 Not Found):**

```json
{
  "error": "Node not found",
  "requestId": "a1b2c3d4"
}
```

---

### `PUT /api/nodes/:id` — Update Node

Updates one or more fields of an existing node.

**Path Parameter:** `id` (UUID v4)

**Request Body (partial update allowed):**

```json
{
  "label": "src/app.ts",
  "metadata": { "path": "src/app.ts", "extension": "ts" }
}
```

**Updatable Fields:**
- `label` (string)
- `node_type` (string)
- `metadata` (JSON object)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "label": "src/app.ts",
    "metadata": { "path": "src/app.ts", "extension": "ts" },
    "updated_at": "2026-08-28T08:35:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

**Error (400 Bad Request):**

```json
{
  "error": "No fields to update. Provide label, node_type, or metadata.",
  "requestId": "a1b2c3d4"
}
```

---

### `DELETE /api/nodes/:id` — Delete Node

Permanently removes a node and its associated edges (cascaded by foreign key).

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Node deleted",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", ... },
  "requestId": "a1b2c3d4"
}
```

---

## CRUD — Graph Edges

Graph edges represent relationships between nodes (e.g., `CONTAINS`, `AUTHORED`, `FIXES`, `DEPENDS_ON`).

### `POST /api/edges` — Create Edge

Creates a relationship between two existing nodes.

**Request Body:**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "source_node_id": "550e8400-e29b-41d4-a716-446655440001",
  "target_node_id": "550e8400-e29b-41d4-a716-446655440002",
  "relation": "CONTAINS",
  "metadata": { "line_number": 42 }
}
```

**Validation Rules:**
- `repo_url` must be a valid GitHub URL.
- `source_node_id` and `target_node_id` must be valid UUIDs referencing existing nodes.
- `relation` is required (string, max 50 chars).

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440003",
    "repo_url": "https://github.com/owner/repo",
    "source_node_id": "550e8400-e29b-41d4-a716-446655440001",
    "target_node_id": "550e8400-e29b-41d4-a716-446655440002",
    "relation": "CONTAINS",
    "metadata": { "line_number": 42 },
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/edges` — List Edges

Retrieves all edges for a repository, optionally filtered by `relation`.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |
| `relation` | string | No | Filter by relation type (e.g., `CONTAINS`, `AUTHORED`) |

**Example:** `GET /api/edges?repoUrl=https://github.com/vercel/next.js&relation=CONTAINS`

**Response (200 OK):**

```json
{
  "success": true,
  "count": 87,
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440003",
      "repo_url": "https://github.com/vercel/next.js",
      "source_node_id": "550e8400-e29b-41d4-a716-446655440001",
      "target_node_id": "550e8400-e29b-41d4-a716-446655440002",
      "relation": "CONTAINS",
      "metadata": {},
      "created_at": "2026-08-28T08:30:00.000Z"
    }
  ],
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/edges/:id` — Get Single Edge

Retrieves a specific edge by its UUID.

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440003",
    "relation": "AUTHORED",
    "metadata": { "date": "2026-08-01" },
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `PUT /api/edges/:id` — Update Edge

Updates the `relation` or `metadata` of an existing edge.

**Path Parameter:** `id` (UUID v4)

**Request Body (partial update):**

```json
{
  "relation": "MODIFIES",
  "metadata": { "commit_sha": "abc1234" }
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440003",
    "relation": "MODIFIES",
    "metadata": { "commit_sha": "abc1234" },
    "updated_at": "2026-08-28T08:35:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `DELETE /api/edges/:id` — Delete Edge

Permanently removes an edge.

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Edge deleted",
  "data": { "id": "660e8400-e29b-41d4-a716-446655440003", ... },
  "requestId": "a1b2c3d4"
}
```

---

## CRUD — Documents

Documents store text chunks and their 1024-dimensional vector embeddings for semantic search.

### `POST /api/documents` — Create Document

Creates a single document with its embedding vector.

**Request Body:**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "content": "The useEffect hook lets you perform side effects in function components...",
  "metadata": {
    "source_type": "code",
    "source_path": "src/hooks/useEffect.ts",
    "chunk_index": 0
  },
  "embedding": [0.023, -0.156, 0.089, ...] // 1024 float values
}
```

**Validation Rules:**
- `repo_url` must be a valid GitHub URL.
- `content` is required (string, max 100,000 chars).
- `embedding` is required (array of 1024 floats).

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440004",
    "repo_url": "https://github.com/owner/repo",
    "content": "The useEffect hook...",
    "metadata": { "source_type": "code", "source_path": "src/hooks/useEffect.ts" },
    "embedding": [0.023, -0.156, ...],
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/documents` — List Documents

Retrieves all documents for a repository.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |

**Example:** `GET /api/documents?repoUrl=https://github.com/vercel/next.js`

**Response (200 OK):**

```json
{
  "success": true,
  "count": 156,
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440004",
      "repo_url": "https://github.com/vercel/next.js",
      "content": "The useEffect hook...",
      "metadata": { "source_type": "code", "chunk_index": 0 },
      "created_at": "2026-08-28T08:30:00.000Z"
    }
  ],
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/documents/:id` — Get Single Document

Retrieves a specific document by its UUID.

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440004",
    "repo_url": "https://github.com/owner/repo",
    "content": "The useEffect hook...",
    "metadata": { "source_type": "code" },
    "embedding": [0.023, -0.156, ...],
    "created_at": "2026-08-28T08:30:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `PUT /api/documents/:id` — Update Document

Updates the `content`, `metadata`, or `embedding` of an existing document.

**Path Parameter:** `id` (UUID v4)

**Request Body (partial update):**

```json
{
  "content": "Updated explanation of useEffect...",
  "metadata": { "source_type": "doc", "chunk_index": 1 }
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440004",
    "content": "Updated explanation of useEffect...",
    "metadata": { "source_type": "doc", "chunk_index": 1 },
    "updated_at": "2026-08-28T08:35:00.000Z"
  },
  "requestId": "a1b2c3d4"
}
```

---

### `DELETE /api/documents/:id` — Delete Document

Permanently removes a document.

**Path Parameter:** `id` (UUID v4)

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Document deleted",
  "data": { "id": "770e8400-e29b-41d4-a716-446655440004", ... },
  "requestId": "a1b2c3d4"
}
```

---

## Application Routes

These routes power the core Cognex functionality: ingestion, querying, and analytics.

### `POST /api/ingest` — Ingest Repository

Triggers the background pipeline that fetches a GitHub repository, builds its knowledge graph, generates embeddings, and stores everything in Supabase.

**Request Body:**

```json
{
  "repoUrl": "https://github.com/facebook/react"
}
```

**Response (202 Accepted — background mode):**

```json
{
  "success": true,
  "status": "accepted",
  "repoUrl": "https://github.com/facebook/react",
  "message": "Ingestion started in background. Poll /api/status for progress.",
  "requestId": "a1b2c3d4",
  "pollEndpoint": "/api/status?repoUrl=https%3A%2F%2Fgithub.com%2Ffacebook%2Freact"
}
```

**Response (200 OK — synchronous, small repos):**

```json
{
  "success": true,
  "status": "success",
  "repoUrl": "https://github.com/owner/small-repo",
  "requestId": "a1b2c3d4",
  "duration": 12.5,
  "nodes": 45,
  "edges": 87,
  "documents": 23
}
```

---

### `POST /api/ask` — Ask a Question

Runs the Agentic RAG pipeline: embeds the query, searches vectors + graph, optionally falls back to web search, and streams an LLM-generated answer.

**Request Body:**

```json
{
  "repoUrl": "https://github.com/facebook/react",
  "query": "How does the useEffect hook work?"
}
```

**Response:** Streaming `text/plain` (Server-Sent Events style). The response body is a continuous stream of tokens from the Groq LLM.

**Headers:**
- `Content-Type: text/plain; charset=utf-8`
- `X-Request-ID: a1b2c3d4`

---

### `GET /api/graph` — Get Knowledge Graph

Retrieves the complete knowledge graph (nodes + edges) for a repository.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |

**Example:** `GET /api/graph?repoUrl=https://github.com/facebook/react`

**Response (200 OK):**

```json
{
  "repoUrl": "https://github.com/facebook/react",
  "nodes": [ ... ],
  "edges": [ ... ],
  "nodeCount": 450,
  "edgeCount": 890,
  "requestId": "a1b2c3d4"
}
```

---

### `GET /api/status` — Ingestion Status

Checks whether a repository has been ingested and returns progress for background jobs.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |

**Response (200 OK):**

```json
{
  "repoUrl": "https://github.com/facebook/react",
  "status": "done",
  "progress": 100,
  "message": "Repository ingested",
  "nodeCount": 450,
  "docCount": 156,
  "requestId": "a1b2c3d4",
  "lastUpdated": "2026-08-28T08:30:00.000Z"
}
```

Possible `status` values: `not_found`, `processing`, `done`, `error`.

---

### `GET /api/stats` — Repository Statistics

Computes aggregate statistics from the knowledge graph.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | GitHub repository URL |

**Response (200 OK):**

```json
{
  "repoUrl": "https://github.com/facebook/react",
  "stats": {
    "totalNodes": 450,
    "totalEdges": 890,
    "nodeTypes": {
      "file": 120,
      "function": 200,
      "contributor": 15,
      "issue": 50,
      "pr": 30,
      "commit": 25,
      "dependency": 10
    },
    "edgeRelations": {
      "CONTAINS": 320,
      "AUTHORED": 25,
      "MODIFIES": 180,
      "REFERENCES": 45,
      "FIXES": 30,
      "DEPENDS_ON": 290
    },
    "topContributors": [
      { "username": "danabramov", "contributions": 1200 },
      { "username": "sophiebits", "contributions": 850 }
    ],
    "topFiles": [
      "packages/react/src/ReactHooks.js",
      "packages/react-dom/src/client/ReactDOMRoot.js"
    ],
    "dependencies": [
      "loose-envify",
      "object-assign",
      "scheduler"
    ]
  },
  "requestId": "a1b2c3d4"
}
```

---

## Error Handling

All errors follow a consistent structure:

```json
{
  "error": "Human-readable description",
  "requestId": "a1b2c3d4"
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| `200` | OK | Successful GET, PUT, DELETE |
| `201` | Created | Successful POST |
| `202` | Accepted | Background job started (`/api/ingest`) |
| `400` | Bad Request | Invalid parameters, missing fields, malformed UUID |
| `404` | Not Found | Resource does not exist |
| `500` | Internal Server Error | Database failure, external API timeout, unexpected exception |

---

## Rate Limits

| Layer | Limit | Notes |
|-------|-------|-------|
| Cloudflare Workers | 100,000 requests/day (free tier) | Burst capacity via global edge network |
| GitHub API | 5,000 requests/hour (with token) | Unauthenticated: 60/hour |
| Groq API | Varies by plan | Check Groq dashboard for current limits |
| Cohere API | Varies by plan | `embed-english-v3.0` batch size max 96 |
| Serper.dev | 2,500 queries (free tier) | Web search fallback only |

---

## Cloud Services Used

| Service | Purpose | Tier |
|---------|---------|------|
| **Cloudflare Pages** | Static frontend hosting | Free |
| **Cloudflare Workers** | Serverless backend / API gateway | Free |
| **Supabase** | PostgreSQL + pgvector database | Free |
| **Groq** | LLM inference (streaming) | Free tier |
| **Cohere** | Text embeddings (1024-D) | Free tier |
| **Serper.dev** | Web search fallback | Free tier (2,500 queries) |
| **GitHub REST API** | Repository data extraction | Free (with PAT) |

---

*Documentation generated for Cognex v1.2.0 — August 2026*
