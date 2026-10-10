import { z } from "zod";

/**
 * The Life line on the Map (post-login handoff, section 7): big moments only, by year, on five rows. Never pitstops or
 * prep. The server fills it from the person's confirmed profile; the design page and the preview use an example.
 */
export const LIFE_ROWS = ["journey", "education", "work", "certificates", "interests"] as const;
export const lifeRow = z.enum(LIFE_ROWS);

export const lifeMoment = z.object({
  id: z.string().min(1).max(80),
  row: lifeRow,
  /** When, as a decimal year: 2024.5 is about July 2024. */
  t: z.number().min(1950).max(2100),
  /** Shown on the map: "Jun 2024" or "2023". */
  date: z.string().min(1).max(40),
  /** Short name on the map. */
  name: z.string().min(1).max(80),
  /** The panel's heading and text. */
  heading: z.string().min(1).max(160),
  detail: z.string().max(400),
  verified: z.boolean().default(false),
});

export const lifeLine = z.object({
  /** Today, as a decimal year. */
  now: z.number().min(1950).max(2100),
  destination: z.string().min(1).max(120),
  moments: z.array(lifeMoment).max(120),
  /** Lines from the resume with no date, so they can't be placed yet. */
  undated: z.array(z.object({ row: lifeRow, name: z.string().min(1).max(160) })).max(60),
});

export type LifeRow = z.infer<typeof lifeRow>;
export type LifeMoment = z.infer<typeof lifeMoment>;
export type LifeLine = z.infer<typeof lifeLine>;
