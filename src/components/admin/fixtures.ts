import type { AdminCompanyView } from "@/lib/corporate/types";
import type { HeldProofView } from "@/lib/schemas/admin";

/** Example rows of the company review list for /design. Synthetic companies on reserved example domains. */
export const exampleReviewCompanies: AdminCompanyView[] = [
  {
    id: "7a0f3c1e-2b4d-4e6f-8a1b-3c5d7e9f1a20",
    name: "Example Labs",
    type: "company",
    domain: "example-labs.test",
    website: "https://www.example-labs.test",
    websiteOnOtherDomain: false,
    city: "Pune",
    size: "51 to 200",
    createdOn: "2026-10-12",
    members: 2,
    admins: 1,
    noAdmin: false,
    status: "pending",
  },
  {
    id: "8b1e4d2f-3c5e-4f70-9b2c-4d6e8f0a2b31",
    name: "Sample Institute of Technology",
    type: "college",
    domain: "students.sample-institute.test",
    website: "https://sample-college.test",
    websiteOnOtherDomain: true,
    city: "Chennai",
    size: "More than 1,000",
    createdOn: "2026-10-11",
    members: 1,
    admins: 1,
    noAdmin: false,
    status: "pending",
  },
  {
    id: "9c2f5e30-4d6f-4081-8c3d-5e7f9a1b3c42",
    name: "Demo Payments",
    type: "company",
    domain: "demo-payments.test",
    website: null,
    websiteOnOtherDomain: false,
    city: null,
    size: "11 to 50",
    createdOn: "2026-10-09",
    members: 0,
    admins: 0,
    noAdmin: true,
    status: "suspended",
  },
];

/** Example rows of the held-proof review (/admin/proofs) for /design. Synthetic people and badge ids. */
export const exampleHeldProofs: HeldProofView[] = [
  {
    id: "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
    certificate: "AWS Certified Cloud Practitioner",
    issuer: "Amazon Web Services",
    reason: "badge_reused",
    reasonText: "Its Credly badge is already verified on another account",
    submittedOn: "2026-10-12",
    person: "Priya S.",
    others: 1,
    badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-0000000000aa",
  },
  {
    id: "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b",
    certificate: "Microsoft Certified: Azure Fundamentals",
    issuer: "Microsoft",
    reason: "credential_reused",
    reasonText: "Its credential id was already used on another account",
    submittedOn: "2026-10-11",
    person: "Ravi K.",
    others: 2,
    badgeUrl: null,
  },
];
