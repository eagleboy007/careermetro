import { ArrowRight, FileText, Route, Target } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { roleViews } from "@/lib/role-view";

const steps = [
  { Icon: FileText, title: "Upload your resume", text: "We read your real experience and you check what we found." },
  { Icon: Target, title: "See your exact gaps", text: "Each gap quotes the line of your resume it came from." },
  { Icon: Route, title: "Follow a short path", text: "Up to six steps with free resources, sized to your week." },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 pb-20">
      <SiteHeader />

      <section className="flex max-w-2xl flex-col gap-5">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">For job seekers in India</p>
        <h1 className="text-4xl font-semibold leading-[1.05] sm:text-6xl">Know exactly what stands between you and the job.</h1>
        <p className="text-lg text-muted">
          Upload your resume and pick the role you want. CareerMetro shows the specific skills you are missing and a short,
          free path to close them.
        </p>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-6">
        <h2 id="how" className="text-2xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(({ Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5">
              <Icon size={22} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="roles-title" className="flex flex-col gap-3">
        <h2 id="roles-title" className="text-2xl font-semibold">
          See what each role asks for
        </h2>
        <p className="max-w-2xl text-muted">
          A first draft, built from public job postings, of the skills and certifications employers ask for across{" "}
          {roleViews.length} roles, from data analyst to cyber security analyst.
        </p>
        <Link href="/roles" className="inline-flex w-fit items-center gap-1.5 font-medium underline underline-offset-4 hover:text-ink">
          Browse roles
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </section>

      <section id="waitlist" aria-labelledby="waitlist-title" className="flex max-w-2xl flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <h2 id="waitlist-title" className="text-2xl font-semibold">
          Get early access
        </h2>
        <p className="text-muted">We’re opening to a small group first. Join the list and we’ll write when your spot is ready.</p>
        <WaitlistForm />
      </section>
    </div>
  );
}
