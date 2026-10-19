import { builderAnswers } from "@/lib/schemas";

/* Example answers for /design and the preview without accounts (handoff 12k, prototype v39). The person is made up. */
export const exampleBuilder = {
  name: "Priya Nair",
  answers: builderAnswers.parse({
    role: { roleSlug: "cyber-security-analyst", stage: "graduated", city: "Pune" },
    education: [{ id: "e1", degree: "B.Sc. Computer Science", college: "Example College, Pune", start: "2021", end: "2024", marks: "8.1 CGPA" }],
    projects: [{ id: "p1", name: "Home security lab", did: "Set up Wazuh on 3 home machines and wrote alert rules for failed logins.", link: "" }],
    worked: true,
    jobs: [{ id: "j1", kind: "internship", company: "Example Infotech", title: "IT support intern", from: "2024-01", to: "2024-06", did: "Closed about 20 tickets a week and reset passwords in Active Directory." }],
    tools: ["Linux", "Active Directory"],
    noCertificates: true,
  }),
};
