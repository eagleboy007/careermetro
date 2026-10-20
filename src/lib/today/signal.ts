import { hash32 } from "@/lib/mock/rules";
import type { SignalGoal } from "@/lib/ride/build";
import { signalLive, type MockChoiceQuestion, type MockQuestion, type SignalAnswer, type SignalLive } from "@/lib/schemas";
import { clip } from "@/lib/text";

/*
 * Today's signal check (handoff section 5, docs/plans/departures-live-plan.md): one multiple-choice question a day from
 * the Practice bank (`mock-bank.json`), for the skill of today's ride goal, or the next goal when the bank has none for
 * it. Picked by code, never by a model; the pick isn't stored, and the answer is checked on the server. Pure, so tests
 * can use it.
 */

const KEYS = ["A", "B", "C", "D"] as const;

/**
 * Questions the card can ask for a skill: multiple choice, reviewed by someone who works in the role (or any, on local
 * and preview deployments), with two to four options short enough for the card.
 */
export function signalPool(bank: readonly MockQuestion[], skillId: string, allowUnreviewed: boolean): MockChoiceQuestion[] {
  return bank.filter(
    (q): q is MockChoiceQuestion =>
      q.kind === "choice" &&
      q.skillId === skillId &&
      (q.reviewed || allowUnreviewed) &&
      q.options.length >= 2 &&
      q.options.length <= KEYS.length &&
      q.answer < q.options.length &&
      q.options.every((o) => o.length <= 120) &&
      q.question.length >= 10 &&
      q.question.length <= 400 &&
      q.explanation.length <= 400,
  );
}

export type SignalPick = { question: MockChoiceQuestion; goal: SignalGoal };

/**
 * The day's question: from the first of the two goals (today's ride goal, then the next) whose skill has questions,
 * chosen by a hash of the person and the India date, so it stays the same all day and changes the next. Null when
 * neither skill has a question: the card is hidden and the ride has no signal task.
 */
export function pickSignal(bank: readonly MockQuestion[], goals: readonly SignalGoal[], userId: string, day: string, allowUnreviewed: boolean): SignalPick | null {
  for (const goal of goals.slice(0, 2)) {
    const pool = signalPool(bank, goal.learnSkillId, allowUnreviewed);
    if (pool.length) return { question: pool[hash32(`${userId}|${day}`) % pool.length], goal };
  }
  return null;
}

export const signalAnswerOf = (q: MockChoiceQuestion): SignalAnswer => ({ correctKey: KEYS[q.answer], explanation: q.explanation });

/** The card's question without its answer, unless it was answered earlier today. */
export function signalLiveOf({ question: q, goal }: SignalPick, answered: boolean): SignalLive {
  return signalLive.parse({
    id: q.id,
    shown: {
      skillName: goal.name,
      status: goal.status,
      question: q.question,
      options: q.options.map((label, i) => ({ key: KEYS[i], label })),
      from: clip(`From your ${goal.name} goal · warms you up for Pitstop ${goal.provePitstop}`, 120),
    },
    answer: answered ? signalAnswerOf(q) : null,
  });
}

/** Whether `key` is one of the question's options. */
export const isSignalKey = (q: MockChoiceQuestion, key: unknown): key is (typeof KEYS)[number] =>
  typeof key === "string" && (KEYS as readonly string[]).includes(key) && KEYS.indexOf(key as (typeof KEYS)[number]) < q.options.length;
