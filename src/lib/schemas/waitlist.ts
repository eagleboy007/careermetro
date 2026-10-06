import { z } from "zod";

export const waitlistSignup = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address").max(254)),
  role: z.string().trim().max(120).optional(),
  consent: z.literal(true, { error: "Tick the box to agree to be emailed" }),
});
export type WaitlistSignup = z.infer<typeof waitlistSignup>;
