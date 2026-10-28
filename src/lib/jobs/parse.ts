import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { costUsd } from "@/lib/ai/cost";
import { isTransient, retryPause } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { skills } from "@/content";
import { taxonomyId } from "@/lib/gaps/match";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";
import { postingSkills, type PostingSkills } from "@/lib/schemas";
import { errorFields, logEvent } from "@/lib/log";

export const PARSE_JD_MODEL = "claude-opus-5-5";
const MAX_ATTEMPTS = 2;
/** The job-check route's maxDuration is 120 s; reading the posting must finish well inside it, leaving time to save. */
export const PARSE_JD_DEADLINE_MS = 100_000;
const ATTEMPT_TIMEOUT_MS = 50_000;
/** A retry is only worth starting with at least this much of the deadline left. */
const MIN_ATTEMPT_MS = 30_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Skills read from one posting at most; the prompt asks for the same. */
export const MAX_POSTING_SKILLS = 40;
/** Names outside our skill list kept for display ("Not in our skill list yet"), and how long each may be. */
export const MAX_UNKNOWN_SKILLS = 15;
export const MAX_UNKNOWN_CHARS = 60;

export type ParseJdClient = Pick<Anthropic, "beta">;

/** The posting's skills in our taxonomy, plus names we don't know yet. Plain code decides all of it. */
export type MappedPosting = {
  /** The company, title and city the model read, each kept only when the posting prints it (postingLabels). */
  company: string | null;
  title: string | null;
  city: string | null;
  requiredSkillIds: string[];
  niceSkillIds: string[];
  unknownSkills: string[];
  /** Skills dropped because their quote isn't in the posting. */
  dropped: number;
};

export type ParseJdResult =
  | ({ ok: true; calls: AiCallRecord[] } & MappedPosting)
  | { ok: false; reason: "refused" | "malformed"; calls: AiCallRecord[] }
  /** error is the failed call's error: callers must not log or return it, since it can echo the posting. */
  | { ok: false; reason: "unavailable"; error: unknown; calls: AiCallRecord[] };

/** Wraps the posting so the model reads it as data (AI-7). A closing tag inside the posting can't end the block early. */
export function wrapPosting(text: string): string {
  // Any tag spelled like the wrapper, with spaces or attributes too ("</job_posting >", "< /JOB_POSTING>"), loses its "<".
  return `<job_posting>\n${text.replace(/<(?=\s*\/?\s*job_posting\b)/gi, "&lt;")}\n</job_posting>`;
}

/** The skills from the response's text block, or null if it is missing, not JSON, or fails the schema. */
export function readPostingSkills(content: Anthropic.Beta.BetaContentBlock[]): PostingSkills | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    const result = postingSkills.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * AI-5 for postings: keeps only skills whose quote appears in the posting, then maps each to our taxonomy by its name,
 * else by its quote. A skill asked for both ways counts as required. A name we don't know is kept for display only,
 * and only when the posting itself prints it, so nothing shown is the model's own words.
 */
const termsById = new Map(skills.map((s) => [s.id, [s.name, ...s.aliases]]));

/** Whether the quote names the skill: its name or one of its aliases appears in it. */
function quoteNames(quote: string, skillId: string): boolean {
  const q = normalizeForMatch(quote);
  return (termsById.get(skillId) ?? []).some((t) => containsPhrase(q, normalizeForMatch(t)));
}

/** The longest company, title and city kept from a posting, as job_checks stores them. */
const LABEL_MAX = { company: 100, title: 120, city: 60 } as const;

/**
 * The company, title and city the model read, each tidied to one line and kept only when the posting itself prints it
 * and it fits its column; else null, and the person types it. Nothing kept is the model's own words.
 */
export function postingLabels(parsed: Pick<PostingSkills, "company" | "title" | "city">, postingText: string): Pick<MappedPosting, "company" | "title" | "city"> {
  const haystack = normalizeForMatch(postingText);
  const keep = (raw: string | null, max: number) => {
    const line = (raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return line && line.length <= max && containsPhrase(haystack, normalizeForMatch(line)) ? line : null;
  };
  return { company: keep(parsed.company, LABEL_MAX.company), title: keep(parsed.title, LABEL_MAX.title), city: keep(parsed.city, LABEL_MAX.city) };
}

export function mapPostingSkills(parsed: Pick<PostingSkills, "skills">, postingText: string): Omit<MappedPosting, "company" | "title" | "city"> {
  const haystack = normalizeForMatch(postingText);
  const inPosting = (s: string) => containsPhrase(haystack, normalizeForMatch(s));
  const required: string[] = [];
  const nice: string[] = [];
  const unknown = new Map<string, string>();
  let dropped = 0;
  for (const skill of parsed.skills.slice(0, MAX_POSTING_SKILLS)) {
    const quote = skill.quote.trim();
    if (!quote || !inPosting(quote)) {
      dropped++;
      continue;
    }
    const name = skill.name.replace(/\s+/g, " ").trim();
    // The quote must back the skill it is given for: the name's skill only counts when the posting's words name it
    // too (the quote itself, or the name printed in the posting). Otherwise a real quote could carry any skill.
    const byName = taxonomyId(name);
    const byQuote = taxonomyId(quote);
    const id = byName && (byName === byQuote || quoteNames(quote, byName) || inPosting(name)) ? byName : byQuote;
    if (id) {
      if (skill.level === "required" && !required.includes(id)) required.push(id);
      else if (skill.level === "nice" && !nice.includes(id)) nice.push(id);
      continue;
    }
    const key = name.toLowerCase();
    if (name && name.length <= MAX_UNKNOWN_CHARS && inPosting(name) && !unknown.has(key) && unknown.size < MAX_UNKNOWN_SKILLS) unknown.set(key, name);
  }
  return { requiredSkillIds: required, niceSkillIds: nice.filter((id) => !required.includes(id)), unknownSkills: [...unknown.values()], dropped };
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: ATTEMPT_TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * "Check against a job": lists the skills a pasted posting names with one model call, retried once if the output is
 * malformed or the call hit a brief outage. The two share one retry, so a posting costs at most two calls. The model
 * only reads the posting; plain code checks every quote and maps the skills (mapPostingSkills), and the matcher alone
 * decides what is a gap. inputRefs identifies the check for the ai_calls log and must hold ids only.
 * Never throws for a failed call: every attempt, including one that errors, is returned in `calls` for logging.
 */
export async function parseJobPosting(
  postingText: string,
  inputRefs: Record<string, string>,
  client: ParseJdClient = getClient(),
  deadlineMs = PARSE_JD_DEADLINE_MS,
): Promise<ParseJdResult> {
  const prompt = loadPrompt("parse-jd");
  const calls: AiCallRecord[] = [];
  const deadline = Date.now() + deadlineMs;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt > 1 && remaining < MIN_ATTEMPT_MS) break;
    const started = Date.now();
    const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean) =>
      calls.push({
        purpose: "parse-jd",
        model,
        promptVersion: prompt.id,
        inputRefs,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        costUsd: usage ? costUsd(model, usage) : 0,
        latencyMs: Date.now() - started,
        ok,
      });

    let response;
    try {
      const timeout = Math.max(1_000, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
      response = await client.beta.messages.create(
        {
          model: PARSE_JD_MODEL,
          max_tokens: 8_000,
          system: prompt.text,
          messages: [{ role: "user", content: wrapPosting(postingText) }],
          output_config: { effort: "medium", format: betaZodOutputFormat(postingSkills) },
          // Re-runs a refused request on a fallback model chosen by the API, inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout },
      );
    } catch (error) {
      record(PARSE_JD_MODEL, null, false);
      // Never the message: it could echo the request, which holds the posting.
      logEvent("error", "ai_call_failed", { purpose: "parse-jd", attempt, ...errorFields(error) });
      // A brief outage (rate limit, overload, dropped connection) gets the second attempt, if there is time for it.
      const wait = retryPause();
      if (attempt < MAX_ATTEMPTS && isTransient(error) && deadline - Date.now() - wait >= MIN_ATTEMPT_MS) {
        await pause(wait);
        continue;
      }
      return { ok: false, reason: "unavailable", error, calls };
    }

    if (response.stop_reason === "refusal") {
      record(response.model, response.usage, false);
      return { ok: false, reason: "refused", calls };
    }
    // Validated here rather than by the SDK's parse helper so the tokens of a malformed attempt are still logged.
    const parsed = response.stop_reason === "max_tokens" ? null : readPostingSkills(response.content);
    record(response.model, response.usage, parsed !== null);
    if (parsed) return { ok: true, calls, ...mapPostingSkills(parsed, postingText), ...postingLabels(parsed, postingText) };
  }
  return { ok: false, reason: "malformed", calls };
}
