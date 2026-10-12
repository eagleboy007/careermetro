import type { CorporateHomeView, SignupDetails } from "@/lib/corporate/types";

/** Made-up company and people for /design and the example preview. No real company or person. */
export const exampleCorporateHome: CorporateHomeView = {
  org: { name: "Example Labs", type: "company", domain: "example-labs.test", website: "https://example-labs.test", status: "pending", createdOn: "2026-10-12", hasPage: true },
  me: { role: "admin", since: "2026-10-12" },
  adminCount: 1,
  secondAdminDaysLeft: 12,
  canOpenJobs: false,
  team: {
    members: [
      { id: "m1", name: "Meera Iyer", role: "admin", workEmailVerifiedOn: "2026-10-12", recheckDue: false, isYou: true },
      { id: "m2", name: "Rahul Menon", role: "hiring", workEmailVerifiedOn: "2026-10-13", recheckDue: false, isYou: false },
    ],
    invites: [{ id: "i1", role: "admin", domain: "example-labs.test", createdOn: "2026-10-13", expiresOn: "2026-10-27" }],
    requests: [{ id: "r1", name: "Farhan Shaikh", domain: "example-labs.test", createdOn: "2026-10-14" }],
  },
};

export const exampleSignupDetails: SignupDetails = {
  type: "company",
  legalName: "Example Labs Private Limited",
  name: "Example Labs",
  website: "https://example-labs.test",
  workEmail: "meera.iyer@example-labs.test",
  size: "51 to 200",
  city: "Pune",
};
