import type { SettingsData } from "./settings-view";

/** Account settings with example data: previews without sign-in, and /design. Nothing can be saved. */
export const exampleSettings: SettingsData = {
  firstName: "Priya",
  lastName: "Nair",
  email: "priya.nair@example.com",
  emailVerified: true,
  method: "google",
  editable: false,
  nameLocked: true,
};
