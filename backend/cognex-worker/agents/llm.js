/** llm.js — thin wrapper around ChatGroq (Llama 3.3 70B). Returns null when no key is configured. */
import { ChatGroq } from '@langchain/groq';

export function createGroqLlm(env = process.env) {
  if (!env.GROQ_API_KEY) return null;
  const model = env.AGENT_MODEL || 'llama-3.3-70b-versatile';
  const chat = new ChatGroq({ apiKey: env.GROQ_API_KEY, model, temperature: 0, maxRetries: 2 });

  async function complete(system, user) {
    const res = await chat.invoke([['system', system], ['user', user]]);
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    return { text, usage: res.usage_metadata || null };
  }
  return { model, complete };
}

/** Pull the first JSON object/array out of a model reply (handles ```json fences). */
export function parseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.search(/[\[{]/);
  if (start < 0) throw new Error('no JSON in model output');
  const open = cleaned[start];
  const end = cleaned.lastIndexOf(open === '[' ? ']' : '}');
  return JSON.parse(cleaned.slice(start, end + 1));
}
