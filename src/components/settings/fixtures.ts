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
    city: "Pune",
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
      companiesCanFind: true,
      rideReminder: "19:30",
      emailCompanyMessages: true,
      emailWeeklySummary: false,
    },
  },
  usernameLockedUntil: null,
  peopleCanFind: false,
  discovery: {
    views: [
      { orgId: "00000000-0000-4000-8000-0000000000a1", company: "Example Labs", times: 2, lastOn: "11 Oct", blocked: false },
      { orgId: "00000000-0000-4000-8000-0000000000a2", company: "Sample Systems", times: 1, lastOn: "4 Oct", blocked: true },
    ],
    blocked: [{ orgId: "00000000-0000-4000-8000-0000000000a2", company: "Sample Systems", since: "5 Oct" }],
  },
};
