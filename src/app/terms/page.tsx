import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Terms · CareerMetro", robots: { index: false } };

/*
 * The terms of use (launch-readiness (c) 4). Drafted by Development 2026-10-15 from the product rules in CLAUDE.md and
 * docs/REQUIREMENTS.md: free during the beta, gaps worked out by code, only proof fills a goal, verified companies only,
 * Report and Block everywhere. A draft until Milin's legal adviser approves it, so it sits behind the preview gate in
 * src/proxy.ts.
 */

const a = "underline underline-offset-2";

const sections: LegalSection[] = [
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
  return <LegalPage title="Terms" intro="The rules for using CareerMetro, for job seekers and for companies." updated="15 Oct 2026" draft sections={sections} />;
}
