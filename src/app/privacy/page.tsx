import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";
import { GRIEVANCE_OFFICER } from "@/lib/grievance";

export const metadata: Metadata = { title: "Privacy · CareerMetro", robots: { index: false } };

/*
 * The privacy notice (DPDP Act 2023; REQUIREMENTS SEC-1, SEC-3, SEC-4; launch-readiness (b) 8 and (c) 4). Drafted by
 * Development 2026-10-15 from what the app actually stores; every retention period here matches the code that enforces
 * it (src/app/api/cron/cleanup/route.ts). A draft until Milin's legal adviser approves it, so it sits behind the preview
 * gate in src/proxy.ts. Change this page whenever what we store changes.
 *
 * For the legal adviser (launch-readiness (b) 8): confirm Anthropic's commercial terms on training before the line in
 * "Our AI provider" ships; confirm Supabase's encryption at rest and region in its DPA; confirm the minimum age.
 */

const a = "underline underline-offset-2";

const sections: LegalSection[] = [
  {
    id: "who",
    heading: "Who we are",
    body: (
      <p>
        CareerMetro helps job seekers in India see which skills a target role asks for, which of them their resume shows, and what to learn next. We decide
        why and how your data is used, so under the Digital Personal Data Protection Act, 2023 we are the data fiduciary.
      </p>
    ),
  },
  {
    id: "what",
    heading: "What we keep, and why",
    body: (
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address, the username and headline you choose, and your settings. We use them to sign you in and to
          show your profile.
        </li>
        <li>
          <strong>Your resume:</strong> we read the file while you upload it and keep what we read from it (your jobs, dates, education, skills and the
          lines under each job) so you can check and edit it. We don&apos;t keep the file itself. We keep a one-way code made from the name on the resume, so
          we can check that the resume is yours, but we never keep the name.
        </li>
        <li>
          <strong>Your gaps, goals and path:</strong> the skills a role asks for, how your resume compares, the goals you set, and the proof you add
          (exam results, certificates and Credly badges). A certificate&apos;s credential number is kept only as a one-way code.
        </li>
        <li>
          <strong>Job descriptions you paste:</strong> we keep the skills the posting asks for, to check your resume against them, but not the posting&apos;s
          text.
        </li>
        <li>
          <strong>Messages and reports:</strong> your chats and the reports you make. If you report something, we keep your report and any note you wrote
          with it, so we can act on it and keep a record of the complaint.
        </li>
        <li>
          <strong>Applications:</strong> when you apply to a job on CareerMetro, the company sees what the application shows you before you send it. A phone
          number is shared only if you choose to share it for an interview. It is stored encrypted and erased when the application closes.
        </li>
        <li>
          <strong>Security records:</strong> one-way codes made from your network address to count limits (they can&apos;t be traced back or linked across
          days), and records of what admins and company members did, which never include message text.
        </li>
      </ul>
    ),
  },
  {
    id: "ai",
    heading: "Our AI provider",
    body: (
      <p>
        To read your resume, we remove your phone number, email address and postal address first. Then we send the rest to Anthropic, our AI provider,
        which may process it outside India. Anthropic doesn&apos;t use it to train models, and neither do we. The model only reads resumes and writes
        explanations. Your skill gaps are worked out by our own code, the same way for everyone.
      </p>
    ),
  },
  {
    id: "where",
    heading: "Where your data is stored",
    body: <p>On servers in Mumbai, India: our database (Supabase) and our app servers (Vercel). Everything is encrypted in transit and at rest.</p>,
  },
  {
    id: "companies",
    heading: "What companies see",
    body: (
      <ul>
        <li>Companies never see your gaps, goals or path, your email address, your phone number (unless you share it), your pay or your notice period.</li>
        <li>
          If you switch on <strong>Let companies find me</strong> in Settings, verified companies can find you from one of their open jobs. They see the
          parts of your profile you chose to show, the role you are aiming at, your city if you gave one in Settings, and how well you match the job. They can narrow a
          search by your experience (only if your profile shows it), the role you are aiming at, your city and whether you have proved skills. Each time a company opens your profile it is
          logged, and you can see which companies viewed you in the last 30 days. You can block a company at any time, and switching it off hides you at once.
        </li>
        <li>
          If a recruiter leaves CareerMetro, the messages they sent you stay in your chat so you keep the record. They then show as &quot;The company
          team&quot; instead of the recruiter&apos;s name.
        </li>
      </ul>
    ),
  },
  {
    id: "how-long",
    heading: "How long we keep it",
    body: (
      <ul>
        <li>A resume checked without an account: deleted after 24 hours.</li>
        <li>
          Your account: until you delete it. Deleting starts a 30-day window in which you can change your mind. After that your data is removed for good,
          except reports you made (kept without your name) and messages a company wrote to you, which stay in the company&apos;s records.
        </li>
        <li>Company profile views: 30 days.</li>
        <li>What a company can see of an application: up to 180 days after the application closes.</li>
        <li>A phone number shared for an interview: erased when the application closes.</li>
        <li>Reports and their notes: kept as a record of the complaint, without your name once your account is deleted.</li>
      </ul>
    ),
  },
  {
    id: "rights",
    heading: "Your choices and rights",
    body: (
      <ul>
        <li>See and correct what we read from your resume at any time.</li>
        <li>
          Download all your data, or delete your account, from <Link href="/settings" className={a}>Settings</Link>.
        </li>
        <li>Withdraw your consent by deleting your account. We then stop using your data and remove it as described above.</li>
        <li>
          Complain to our Grievance Officer at{" "}
          <a href={`mailto:${GRIEVANCE_OFFICER.email}`} className={a}>
            {GRIEVANCE_OFFICER.email}
          </a>{" "}
          (see <Link href="/grievances" className={a}>Grievances</Link>). If you aren&apos;t satisfied, you can complain to the Data Protection Board of India.
        </li>
      </ul>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies",
    body: (
      <p>
        We use only the cookies the app needs: one that keeps you signed in, and one that links a resume you check without an account to your browser for
        24 hours. There are no advertising or tracking cookies.
      </p>
    ),
  },
  {
    id: "breach",
    heading: "If something goes wrong",
    body: <p>If your data is ever exposed, we tell you and the Data Protection Board as the law requires, and say what we are doing about it.</p>,
  },
];

export default function PrivacyPage() {
  return <LegalPage title="Privacy" intro="What CareerMetro keeps about you, why, for how long, and what you can do about it." updated="15 Oct 2026" draft sections={sections} />;
}
