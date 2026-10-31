import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";
import { junctionEnabled } from "@/lib/preview";
import { JUNCTION_REPORT_REASON_LABELS, JUNCTION_REPORT_REASONS } from "@/lib/schemas/constants";
import { APPEAL_DECIDE_DAYS, APPEAL_WITHIN_DAYS, EDIT_WINDOW_MINUTES, GAC_APPEAL_DAYS, NEW_ACCOUNT_LINK_WAIT_DAYS, NEW_ACCOUNT_POST_WAIT_HOURS } from "@/lib/schemas/legal-timings";

export const metadata: Metadata = { title: "Terms · CareerMetro", robots: { index: false } };

/*
 * The terms of use (launch-readiness (c) 4). Drafted by Development 2026-10-15 from the product rules in CLAUDE.md and
 * docs/REQUIREMENTS.md: free during the beta, gaps worked out by code, only proof fills a goal, verified companies only,
 * Report and Block everywhere. A draft until Milin's legal adviser approves it, so it sits behind the preview gate in
 * src/proxy.ts.
 *
 * "Junction rules" (FR-61, docs/plans/junction-plan.md section 2.8): drafted 2026-10-31 for the lawyer to review, and
 * shown only while JUNCTION_ENABLED is "1", so nobody reads rules for a board they can't use. The composer asks people
 * to accept them (consents purpose junction_rules, JUNCTION_RULES_VERSION).
 */

const a = "underline underline-offset-2";

const sections: (LegalSection & { junctionOnly?: true })[] = [
  {
    id: "service",
    heading: "What CareerMetro is",
    body: (
      <>
        <p>
          CareerMetro compares your resume with what a target role asks for, shows the skills you are missing with the evidence for each, and suggests free
          ways to learn them. Companies verified by us can post jobs and, if you allow it, find you.
        </p>
        <p>CareerMetro is free while it is in beta.</p>
      </>
    ),
  },
  {
    id: "advice",
    heading: "What we can and can't promise",
    body: (
      <ul>
        <li>Your skill gaps are worked out by our code from your resume and our role profiles. They are a guide, not a guarantee of any job or interview.</li>
        <li>Explanations are written with AI and can be wrong. Check what we read from your resume, and correct it if it isn&apos;t right.</li>
        <li>Learning links go to free resources run by others. We don&apos;t control them.</li>
      </ul>
    ),
  },
  {
    id: "account",
    heading: "Your account",
    body: (
      <ul>
        <li>Use your own name and your own resume, and keep what you tell us true.</li>
        <li>Only real proof counts: an exam you passed, or a certificate or badge that is yours. We may check a certificate, hold it for review, or remove it.</li>
        <li>Keep your sign-in to yourself. You are responsible for what happens on your account.</li>
      </ul>
    ),
  },
  {
    id: "rules",
    heading: "Rules for everyone",
    body: (
      <>
        <p>On CareerMetro, nobody may:</p>
        <ul>
          <li>ask anyone for money, an OTP, or bank or card details, or offer a job in exchange for a fee;</li>
          <li>post a fake job, or pretend to be someone else or another company;</li>
          <li>harass, threaten or abuse anyone, or send sexual content;</li>
          <li>scrape or copy other people&apos;s data, or try to get round our limits or security;</li>
          <li>break Indian law.</li>
        </ul>
        <p>
          Use Report on anything that breaks these rules. We may remove content, suspend a company, or close an account that breaks them. See{" "}
          <Link href="/grievances" className={a}>
            Grievances
          </Link>{" "}
          for how we handle complaints and how quickly.
        </p>
      </>
    ),
  },
  {
    id: "companies",
    heading: "For companies",
    body: (
      <ul>
        <li>Only verified companies can post jobs or find people. We verify each company and may suspend one at any time.</li>
        <li>Use what you see of a person only to hire for the job you posted or searched from. Never contact them outside CareerMetro without their consent.</li>
        <li>A message request is one message. Nothing more can be sent until the person accepts it.</li>
      </ul>
    ),
  },
  {
    id: "job-boards",
    heading: "Jobs from company job boards",
    body: (
      <>
        <p>
          Departures lists roles that companies publish on their public job boards (Greenhouse, Lever, Ashby and SmartRecruiters). We read each board
          once a day through its public feed, keep the role&apos;s title, company and place as the board publishes them, and link to the original posting.
          You apply on the company&apos;s own site. We don&apos;t copy the job description, and we don&apos;t keep any recruiter&apos;s name or contact
          details. The skills we tag on a role are our own reading of the post, not the employer&apos;s.
        </p>
        <p>
          A role leaves Departures when its board stops listing it. If your company wants its board removed, write to us from the{" "}
          <Link href="/grievances" className={a}>
            Grievances
          </Link>{" "}
          page and name the board. We take it off within 2 working days, and its roles leave Departures on the next daily read.
        </p>
      </>
    ),
  },
  {
    id: "junction",
    heading: "Junction rules",
    junctionOnly: true,
    body: (
      <>
        <p>
          Junction is CareerMetro&apos;s board for ideas, questions, wins and learning resources. Everyone signed in to CareerMetro can read what you post
          there; it isn&apos;t public and search engines don&apos;t see it. It is free for everyone.
        </p>
        <ul>
          <li>Post in English, about learning, work and careers. No company or job ads.</li>
          <li>Don&apos;t post your own or anyone&apos;s phone number, email, address or documents. Links must start with https.</li>
          <li>
            New accounts wait {NEW_ACCOUNT_POST_WAIT_HOURS} hours before they can post, and {NEW_ACCOUNT_LINK_WAIT_DAYS} days before a post can carry a link.
          </li>
          <li>You can edit a post for {EDIT_WINDOW_MINUTES} minutes; after that you can delete it. Deleting a post deletes the comments on it.</li>
          <li>You can&apos;t post, or ask others to post, anything in this list. Use Report on any post or comment that breaks it:</li>
        </ul>
        <ul>
          {JUNCTION_REPORT_REASONS.filter((r) => r !== "other").map((r) => (
            <li key={r}>{JUNCTION_REPORT_REASON_LABELS[r]}</li>
          ))}
        </ul>
        <p>
          A post that gets enough reports may be held out of the feeds until we look at it. If we hide your post or comment, you see the rule it broke and
          can appeal within {APPEAL_WITHIN_DAYS} days; we decide within {APPEAL_DECIDE_DAYS} days. If you still disagree, you can appeal to the Grievance
          Appellate Committee within {GAC_APPEAL_DAYS} days. We may suspend an account that keeps breaking these rules. Nothing on Junction is checked
          before it appears, and posts are the views of the people who write them.
        </p>
      </>
    ),
  },
  {
    id: "content",
    heading: "Your content",
    body: (
      <p>
        What you add stays yours. You let us store and show it as the app needs, for example your profile to companies you allow. We never use your resume to
        train AI models. How we handle your data is in our{" "}
        <Link href="/privacy" className={a}>
          privacy notice
        </Link>
        .
      </p>
    ),
  },
  {
    id: "ending",
    heading: "Ending",
    body: <p>You can delete your account at any time from Settings. We may change these terms; if a change matters, we tell you before it applies.</p>,
  },
  {
    id: "law",
    heading: "Law",
    body: <p>These terms are governed by the laws of India.</p>,
  },
];

export default function TermsPage() {
  // Junction's rules show only while Junction itself is on (src/lib/preview.ts).
  const shown = sections.filter((s) => !s.junctionOnly || junctionEnabled()).map((s) => ({ id: s.id, heading: s.heading, body: s.body }));
  return <LegalPage title="Terms" intro="The rules for using CareerMetro, for job seekers and for companies." updated="15 Oct 2026" draft sections={shown} />;
}
