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
  draft: {
    username: "priya-n",
    headline: "IT support moving into security operations",
    currentPay: "4.2",
    expectedPay: "6",
    settings: {
      visibility: "signed_in",
      showTargetRole: false,
      showExperience: true,
      showEducation: true,
      showSkills: true,
      showGaps: false,
      showCertifications: true,
      rideReminder: "19:30",
      emailCompanyMessages: true,
      emailWeeklySummary: false,
    },
  },
  usernameLockedUntil: null,
};
