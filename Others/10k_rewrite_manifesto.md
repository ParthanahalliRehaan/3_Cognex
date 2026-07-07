# 🧠 Cognex

## 🚀 Overview
This project builds a **Knowledge Graph** from a GitHub repository link and enables users to **ask questions (doubts)** about the project.  
It integrates **Agentic RAG**, **Context Engineering**, and **Basic AI Engineering** to provide intelligent, context-aware answers.

---

## 🛠️ Core Features

### 1. Knowledge Graph Construction
- Extract repo metadata: README, code files, issues, PRs, commits.
- Build graph relationships:
  - **Nodes**: files, functions, contributors, issues, dependencies.
  - **Edges**: relationships (e.g., function calls, contributor commits).
- Store embeddings in **Supabase (pgvector)** for semantic search.

### 2. Embedding Model (Free)
- Use **SentenceTransformers: `all-MiniLM-L6-v2`** (free, open-source).
- Provides 384-dimensional embeddings.
- Fast and lightweight → suitable for Cloudflare Workers + Supabase.
- Integration:
  - Backend (Node.js) calls model via `transformers.js` or `sentence-transformers` (Python microservice).
  - Embeddings stored in Supabase pgvector for retrieval.

### 3. Agentic RAG (Retrieval-Augmented Generation)
- Agents orchestrate retrieval from:
  - Knowledge graph
  - Supabase embeddings
  - External web search
- Multi-hop reasoning across graph nodes.
- Context-aware answers tailored to user queries.

### 4. Context Engineering
- **Dynamic context window management**:
  - Summarization + trimming for long contexts.
  - Prioritization of relevant graph nodes.
- **Mixed methods**:a
  - Summarization for docs/issues.
  - Selective trimming for code snippets.

### 5. Doubt Resolution (Q&A)
- User asks questions like:
  - *“What are the main dependencies of this repo?”*
  - *“Which contributor worked most on feature X?”*
- System pipeline:
  1. Parse query.
  2. Retrieve relevant nodes (graph + embeddings).
  3. Apply context engineering.
  4. Generate answer via Groq API + Vercel AI SDK.
  5. Stream response to frontend.

### 6. Basic AI Engineering
- Streaming responses.
- Configurable parameters:
  - `temperature`, `top-p`, `max tokens`.
- Web search augmentation.
- SDK-driven orchestration (Vercel AI SDK).
- Groq API for fast inference.

---

## 🏗️ Tech Stack

| Layer          | Technology                                     |
|----------------|------------------------------------------------|
| **Frontend**   | Cloudflare Pages (HTML, CSS, JS)               |
| **Backend**    | Cloudflare Workers (Node.js)                   |
| **Database**   | Supabase (Postgres + pgvector)                 |
| **Embeddings** | BAAI/bge-large-en-v1.5(Resolve HF Issue)       |
| **Inference**  | Groq API                                       |
| **Search**     | Web search integration                         |

---

## 🔄 Architecture Flow

1. **Input**: User provides GitHub project link.
2. **Graph Builder**: Backend extracts repo data → builds knowledge graph.
3. **Embedding Store**: Free embedding model generates vectors → stored in Supabase pgvector.
4. **User Query**: User asks a doubt/question.
5. **Agentic RAG**:
   - Retrieve relevant graph nodes + embeddings.
   - Use external web search if needed.
6. **Context Engineering**:
   - Summarization + trimming for optimal context window.
7. **Answer Generation**:
   - Groq API + Vercel AI SDK generate streaming response.
8. **Frontend Display**:
   - Interactive visualization of graph.
   - AI-powered Q&A interface.

---

## ⚙️ Configurable Parameters
- `temperature`: Creativity control.
- `top-p`: Nucleus sampling.
- `max tokens`: Response length.
- `streaming`: Real-time output.
- `web search`: External augmentation.

---

## 📊 Example Use Case

- Input: `https://github.com/vercel/next.js`
- Graph: Contributors, commits, dependencies, issues.
- User Query: *“What are the main dependencies of Next.js?”*
- Output:
  - Retrieved nodes: `package.json`, dependency edges.
  - Summarized context.
  - AI Answer: *“Next.js relies on React, React-DOM, and SWC for compilation…”*

