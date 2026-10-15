import { practiceQuestions, skills } from "@/content";
import { practiceTrend, practiceView, type PracticeFeedback, type PracticeTag, type PracticeTrend, type PracticeView } from "@/lib/schemas";

/*
 * Example Practice for the design page and the preview without sign-in: a Data Analyst line with SQL met, Python the
 * current goal and Written and verbal communication ahead. The questions are the real bank's; the ratings and the
 * feedback are made up.
 */

const nameOf = (id: string) => skills.find((s) => s.id === id)?.name ?? id;
const skill = (skillId: string, tag: PracticeTag, ratings: number[]) => ({
  skillId,
  name: nameOf(skillId),
  tag,
  questions: practiceQuestions.filter((q) => q.skillId === skillId).map((q) => ({ id: q.id, question: q.question, lookFor: q.lookFor })),
  ratings,
});

export const examplePractice: PracticeView = practiceView.parse({
  skills: [skill("python", "current", [1, 2, 2, 3]), skill("communication", "ahead", [2]), skill("sql", "met", [3, 3, 4])],
  left: 7,
  noQuestions: [nameOf("tableau"), nameOf("power-bi")],
});

/** The same person at 0 answers left today, for the design page. */
export const examplePracticeSpent: PracticeView = { ...examplePractice, left: 0 };

/** Made-up feedback in the shape the prompt returns, for the design page and the preview. */
export const exampleFeedback: PracticeFeedback = {
  structure: "You said what each one is, but not when you'd pick it. Try: what it is, how they differ, then one case for each, so it's easy to follow.",
  specificity: "Add one real example, such as a list of rows you add to while reading a file and a tuple for a fixed (date, store, total) record.",
  correctness: "Right that a list can change and a tuple can't. One thing to add: because a tuple can't change, it can be a dictionary key and a list can't.",
  strongerAnswer:
    "A list can change after I make it: I can add, remove or reorder items, so I use one for things that grow, like rows I collect while reading a file. A tuple is fixed once made, so I use it for a record that shouldn't change, like a (date, store, total) row. Because a tuple can't change, it can also be a dictionary key, which a list can't. In a college project I kept each day's sales as tuples and the list of days as a list.",
};

/** "Practice confidence" on Me, from the same example. */
export const exampleTrends: PracticeTrend[] = examplePractice.skills
  .filter((s) => s.ratings.length > 0)
  .map((s) => practiceTrend.parse({ skillId: s.skillId, name: s.name, ratings: s.ratings }));
