# Workflow
USER PASTES URL (e.g., github.com/facebook/react)
         │
         ▼
┌──────────────────┐
│  POST /api/ingest│
│  {repoUrl: ...}  │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────────────┐
│  index.js       │────►│  rag.ingestRepo()           │
│  (validates URL)│     │  • import('./github.js')    │
└─────────────────┘     │  • import('./graph.js')     │
                        │  • import('./embeddings.js')│
                        │  • import('./supabase.js')  │
                        │                             │
                        │  BACKGROUND PROCESSING      │
                        │  (30-120 seconds)           │
                        └─────────────┬───────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────────┐
                        │  Supabase DB now has:       │
                        │  • documents (vectors)      │
                        │  • graph_nodes              │
                        │  • graph_edges              │
                        └─────────────────────────────┘
                                      │
         ┌────────────────────────────┘
         │  (2 minutes later)
         ▼
USER TYPES QUESTION: "How does React's useEffect work?"
         │
         ▼
┌──────────────────┐
│  POST /api/ask   │
│  {repoUrl, query}│
└────────┬─────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────────────┐
│  index.js       │────►│  rag.handleQuery()          │
│  (validates)    │     │  • import('./supabase.js')  │
└─────────────────┘     │  • import('./groq.js')      │
                        │  • import('./search.js')    │
                        │                             │
                        │  REAL-TIME (2-5 seconds)    │
                        │  Streams answer back        │
                        └─────────────────────────────┘
# What is this polling? Lazy Loading?
--> Its like giving your cloths to dry cleaner service provider. They return 202 to you and you go after each hour to check whether dry cleanings done!
# Like, is RAG Agentic as it decides whether to use ingest, whether RAG decides if ingestion is needed?