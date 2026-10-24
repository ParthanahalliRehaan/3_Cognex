/**
 * graph.js — LangGraph orchestrator for the security-monitor agents.
 *
 *   START -> analyst --(findings?)--> classifier -> reporter -> END
 *                  \--(none)---------------------> reporter
 *
 *  analyst    : reads the masked per-actor table, proposes findings (patterns)
 *  classifier : maps each finding to a threat actor + severity
 *  reporter   : writes the short incident summary
 *
 * GUARDRAILS
 *  • read-only: the orchestrator receives rows, never a store handle; nothing is written/blocked/deleted
 *  • masked: only aggregate()'s pseudonymised table reaches the model
 *  • validated: findings that cite an unknown actor, or enums outside the allowed set, are dropped
 *  • fallback: no key / model error -> deterministic rules, and `mode` says so
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { aggregate } from './aggregate.js';
import { createMasker } from './mask.js';
import { parseJson } from './llm.js';

export const THREAT_ACTORS = ['brute_force_attacker', 'malicious_insider', 'none'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const THRESHOLDS = { bruteForceFails: 8, rejectedBurst: 6, massDelete: 8 };

// ─── deterministic baseline (also the fallback) ──────────────────────────────
export function heuristicFindings(summary) {
  const out = [];
  for (const a of summary.actors) {
    const fails = a.login_failed + a.mfa_failed;
    if (fails >= THRESHOLDS.bruteForceFails) {
      out.push({ actor: a.actor, pattern: 'repeated_failed_logins', evidence: `${fails} failed auth attempts in ${a.active_seconds}s (${a.rate_limited} rate-limited)` });
    }
    if (a.rejected_401 + a.rejected_403 >= THRESHOLDS.rejectedBurst) {
      out.push({ actor: a.actor, pattern: 'rejected_request_burst', evidence: `${a.rejected_401} x 401 and ${a.rejected_403} x 403 in ${a.active_seconds}s` });
    }
    if (a.deletes >= THRESHOLDS.massDelete && a.kind === 'account') {
      out.push({ actor: a.actor, pattern: 'mass_delete', evidence: `${a.deletes} delete operations in ${a.active_seconds}s by one account` });
    }
  }
  return out;
}

const PATTERN_TO_ACTOR = {
  repeated_failed_logins: ['brute_force_attacker', 'high'],
  rejected_request_burst: ['brute_force_attacker', 'medium'],
  mass_delete: ['malicious_insider', 'high'],
};
export function heuristicClassify(f) {
  const [threat_actor, severity] = PATTERN_TO_ACTOR[f.pattern] || ['none', 'low'];
  return { ...f, threat_actor, severity, rationale: `rule: ${f.pattern}` };
}

// ─── prompts ────────────────────────────────────────────────────────────────
const ANALYST_SYS = `You are a log-analyst agent for a web app's audit log. You receive a JSON table of PSEUDONYMISED actors (accounts and IPs) with event counts. Identify suspicious patterns only when the numbers clearly justify it:
- repeated failed logins / MFA failures (roughly 8 or more in a short window)
- bursts of 401/403 rejections (roughly 6 or more)
- one account performing many deletes (roughly 8 or more)
Normal traffic (a few typos, a handful of successful logins, occasional single rejection) is NOT suspicious: return an empty list.
Reply with ONLY a JSON array: [{"actor":"<actor id from the table>","pattern":"repeated_failed_logins|rejected_request_burst|mass_delete","evidence":"<short, cite the numbers>"}]`;

const CLASSIFIER_SYS = `You are a threat-classifier agent. For each finding choose the threat actor and severity.
threat_actor: "brute_force_attacker" (external guessing of credentials), "malicious_insider" (an authenticated account abusing its access, e.g. mass deletes), or "none".
severity: low | medium | high | critical.
Reply with ONLY a JSON array, same order and length as the input: [{"actor":"...","pattern":"...","threat_actor":"...","severity":"...","rationale":"<one sentence>"}]`;

const REPORTER_SYS = `You are an incident-reporter agent. Write a concise markdown incident summary (max 120 words) for a security reviewer: one heading, one bullet per incident (actor id, threat actor, severity, evidence), and one line of recommended human follow-up. You only advise; never claim any action was taken. If there are no incidents, say so in one sentence.`;

// ─── builder ──────────────────────────────────────────────────────────────────
export function buildMonitorGraph({ llm = null, tracer = null } = {}) {
  const trace = tracer || { span: async (_n, _i, fn) => fn(), generation: () => ({ end() {} }) };

  async function ask(name, system, user) {
    const gen = trace.generation(name, llm.model, { system, user });
    const { text, usage } = await llm.complete(system, user);
    gen.end({ output: text, usage: usage ? { input: usage.input_tokens, output: usage.output_tokens } : undefined });
    return text;
  }

  const State = Annotation.Root({
    summary: Annotation(),
    findings: Annotation(),
    classified: Annotation(),
    report: Annotation(),
    mode: Annotation(),
    notes: Annotation({ reducer: (a, b) => (a || []).concat(b || []), default: () => [] }),
  });

  const analyst = async (s) => trace.span('log-analyst', s.summary, async () => {
    const known = new Set(s.summary.actors.map((a) => a.actor));
    if (!llm) return { findings: heuristicFindings(s.summary), mode: 'heuristic', notes: ['no GROQ_API_KEY: rules used'] };
    try {
      const raw = parseJson(await ask('analyst', ANALYST_SYS, JSON.stringify(s.summary)));
      const findings = (Array.isArray(raw) ? raw : []).filter((f) => known.has(f?.actor) && typeof f.pattern === 'string');
      return { findings, mode: 'llm', notes: [`analyst: ${raw.length} proposed, ${findings.length} valid`] };
    } catch (e) {
      return { findings: heuristicFindings(s.summary), mode: 'heuristic', notes: [`analyst failed (${e.message}); rules used`] };
    }
  });

  const classifier = async (s) => trace.span('threat-classifier', s.findings, async () => {
    if (!llm || s.mode === 'heuristic') return { classified: s.findings.map(heuristicClassify) };
    try {
      const raw = parseJson(await ask('classifier', CLASSIFIER_SYS, JSON.stringify(s.findings)));
      const classified = s.findings.map((f, i) => {
        const c = raw[i] || {};
        const ok = THREAT_ACTORS.includes(c.threat_actor) && SEVERITIES.includes(c.severity);
        return ok ? { ...f, threat_actor: c.threat_actor, severity: c.severity, rationale: String(c.rationale || '') } : heuristicClassify(f);
      });
      return { classified };
    } catch (e) {
      return { classified: s.findings.map(heuristicClassify), notes: [`classifier failed (${e.message}); rules used`] };
    }
  });

  const reporter = async (s) => trace.span('reporter', s.classified || [], async () => {
    const incidents = (s.classified || []).filter((c) => c.threat_actor !== 'none');
    const template = incidents.length
      ? `## Security incident summary\n${incidents.map((i) => `- **${i.actor}** — ${i.threat_actor}, severity ${i.severity}: ${i.evidence}`).join('\n')}\n\nRecommended (human) follow-up: review these actors in the audit log; consider resetting credentials or revoking roles.`
      : 'No incidents detected in this window.';
    if (!llm || !incidents.length) return { report: template, classified: s.classified || [] };
    try { return { report: (await ask('reporter', REPORTER_SYS, JSON.stringify(incidents))).trim(), classified: s.classified }; }
    catch { return { report: template, classified: s.classified }; }
  });

  return new StateGraph(State)
    .addNode('analyst', analyst)
    .addNode('classifier', classifier)
    .addNode('reporter', reporter)
    .addEdge(START, 'analyst')
    .addConditionalEdges('analyst', (s) => (s.findings.length ? 'classifier' : 'reporter'), ['classifier', 'reporter'])
    .addEdge('classifier', 'reporter')
    .addEdge('reporter', END)
    .compile();
}

/** Run the monitor over raw audit rows (read-only). */
export async function runMonitor(rows, { llm = null, tracer = null, masker = createMasker() } = {}) {
  const summary = aggregate(rows, { masker });
  const graph = buildMonitorGraph({ llm, tracer });
  const out = await graph.invoke({ summary });
  const incidents = (out.classified || []).filter((c) => c.threat_actor !== 'none');
  return { summary, mode: out.mode, findings: out.findings, classified: out.classified || [], incidents, report: out.report, notes: out.notes };
}
