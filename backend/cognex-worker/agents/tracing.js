/**
 * tracing.js — Langfuse tracing (optional). Enabled when LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are set; otherwise every call is a cheap no-op.
 * Only masked data is ever passed in here.
 */
import { Langfuse } from 'langfuse';

export function createTracer(name, input, env = process.env) {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    return { enabled: false, span: async (_n, _i, fn) => fn(), generation: () => ({ end() {} }), score() {}, finish: async () => {}, url: null };
  }
  const lf = new Langfuse({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL || env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  });
  const trace = lf.trace({ name, input, tags: ['cognex', 'security-monitor'] });
  return {
    enabled: true,
    url: trace.getTraceUrl?.() ?? null,
    async span(n, i, fn) {
      const s = trace.span({ name: n, input: i });
      try { const out = await fn(); s.end({ output: out }); return out; }
      catch (e) { s.end({ level: 'ERROR', statusMessage: String(e) }); throw e; }
    },
    generation(n, model, i) { return trace.generation({ name: n, model, input: i }); },
    score(n, value, comment) { trace.score({ name: n, value, comment }); },
    async finish(output) { trace.update({ output }); await lf.flushAsync(); },
  };
}
