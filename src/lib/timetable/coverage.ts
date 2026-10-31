import { eventFeeds, interestTopics, manualEventsJson, skills } from "@/content";
import { norm } from "@/lib/departures/feed-rules.mjs";
import { manualEvent, type EventFeed, type InterestTopic, type Skill } from "@/lib/schemas";
import { topicWordOf } from "./feed";
import { interestTopicsFor, topicMatchersFor, topicsOf, type TimetablePerson } from "./match";

/*
 * Does the Timetable list events for this person's field at all (T181)? Plain code over the content files, never a
 * list of roles or fields. Only an event source counts: a hand-entered event (the skills it lists and the interest
 * topics its title names) or a feed that is on (a confs.tech file's topic word; an iCalendar feed names no topic, so
 * it adds none). A topic in interest-topics.json with no source behind it does not count. Skills and interest topics
 * that share a word (a key, name or plain alias) cover each other, so a CI/CD event covers a DevOps interest and a
 * Kubernetes goal. When events or feeds for a new field are added, that field switches on by itself.
 */

export type CoverageContent = {
  skills: readonly Skill[];
  topics: readonly InterestTopic[];
  /** src/content/manual-events.json as read, unparsed; entries that fail their schema are skipped. */
  manualEvents: unknown;
  feeds: readonly EventFeed[];
};

export type Coverage = { skills: Set<string>; topics: Set<string> };

const DEFAULT_CONTENT: CoverageContent = { skills, topics: interestTopics, manualEvents: manualEventsJson, feeds: eventFeeds };

/** An entry's plain words: its id or key with spaces, its name and its aliases, less the ambiguous ones. */
const wordsOf = (id: string, name: string, aliases: readonly string[], ambiguous: readonly string[]) => {
  const skip = new Set(ambiguous.map(norm));
  return [id.replace(/-/g, " "), name, ...aliases].map(norm).filter((w) => !skip.has(w));
};

/** The skill ids and interest topic keys some event source covers. */
export function eventCoverage(content: CoverageContent = DEFAULT_CONTENT): Coverage {
  const skillsCovered = new Set<string>();
  const topicsCovered = new Set<string>();
  const words = new Set<string>();

  if (Array.isArray(content.manualEvents)) {
    const matchers = topicMatchersFor(content.skills, content.topics);
    for (const raw of content.manualEvents) {
      const e = manualEvent.safeParse(raw);
      if (!e.success) continue;
      for (const topic of e.data.topics) skillsCovered.add(topic);
      for (const t of topicsOf(e.data.title, "", matchers)) (t.kind === "skill" ? skillsCovered : topicsCovered).add(t.topic);
    }
  }
  for (const f of content.feeds) {
    if (!f.on || f.format !== "confs-tech") continue;
    for (const word of f.urls.map(topicWordOf)) if (word) words.add(norm(word));
  }

  const skillWords = content.skills.map((s) => ({ id: s.id, words: wordsOf(s.id, s.name, s.aliases, s.ambiguous) }));
  const topicWords = content.topics.map((t) => ({ id: t.key, words: wordsOf(t.key, t.label, t.aliases, t.ambiguous) }));
  // A covered skill covers a topic sharing a word with it, and a covered topic then covers its skills: CI/CD listed on
  // an event covers DevOps, and DevOps covers Kubernetes. One step each way, so it never spreads further.
  for (const s of skillWords) if (skillsCovered.has(s.id)) s.words.forEach((w) => words.add(w));
  for (const t of topicWords) if (t.words.some((w) => words.has(w))) topicsCovered.add(t.id);
  for (const t of topicWords) if (topicsCovered.has(t.id)) t.words.forEach((w) => words.add(w));
  for (const s of skillWords) if (s.words.some((w) => words.has(w))) skillsCovered.add(s.id);
  return { skills: skillsCovered, topics: topicsCovered };
}

let defaultCoverage: Coverage | null = null;

/**
 * Whether any event source covers this person's field: one of their goal skills, or an interest topic their Me
 * interests map to. False sends the empty Timetable to "events for this field aren't listed yet". With no goals and no
 * interests there is nothing to judge, so it is true: adding them is the fix.
 */
export function timetableCovers(person: Pick<TimetablePerson, "goalSkillIds" | "interestKeys">, content?: CoverageContent): boolean {
  if (!person.goalSkillIds.length && !person.interestKeys.length) return true;
  const covered = content ? eventCoverage(content) : (defaultCoverage ??= eventCoverage());
  if (person.goalSkillIds.some((id) => covered.skills.has(id))) return true;
  return interestTopicsFor(person.interestKeys, content?.topics ?? interestTopics).some((key) => covered.topics.has(key));
}
