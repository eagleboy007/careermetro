import { Download, KeyRound, Lock, Mail, Trash2, User } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SignInMethod } from "@/lib/account/store";
import { BasicsForm } from "./basics-form";
import { DeleteAccount } from "./delete-account";
import { SettingsNav } from "./settings-nav";

export type SettingsData = {
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  method: SignInMethod | null;
  /** False on example data: nothing can be saved, downloaded or deleted. */
  editable: boolean;
};

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export const SETTINGS_SECTIONS = [
  { id: "acc-basics", label: "Profile basics" },
  { id: "acc-signin", label: "Email and sign-in" },
  { id: "acc-data", label: "Your data" },
] as const;

const ghostSm = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8rem] font-medium text-ink hover:bg-surface-2";

/**
 * Account settings (handoff 12c, prototype v32), part 1: name, the locked sign-in email, how the person signs in,
 * download and delete. Photo, username, pay, privacy and notifications come in part 2 (dev/account-settings-plan.md).
 */
export function SettingsView({ data }: { data: SettingsData }) {
  return (
    <div className="-mx-4 -mt-6 grid min-[760px]:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNav sections={SETTINGS_SECTIONS} />
      <div className="flex min-w-0 max-w-[820px] flex-col gap-[18px] px-[14px] pb-24 pt-4 min-[760px]:px-7 min-[760px]:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[1.7rem] font-semibold leading-[1.1]">Account settings</h1>
            <p className="mt-1 text-[0.92rem] text-muted">Your details, sign-in and privacy. Only you see this page.</p>
          </div>
          <Link href="/me" className={ghostSm}>
            <User {...ICON} />
            Your profile
          </Link>
        </div>

        {!data.editable && (
          <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Preview with example data. Sign in to change your own settings.</p>
        )}

        <Section id="acc-basics" title="Profile basics" tag="shown on your profile">
          <BasicsForm firstName={data.firstName} lastName={data.lastName} editable={data.editable} />
        </Section>

        <Section id="acc-signin" title="Email and sign-in" tag="private">
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.82rem] font-semibold">Email</span>
            <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-dashed border-line bg-surface-2 px-3 py-[9px] text-[0.9rem]">
              <Lock {...ICON} className="text-muted" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{data.email}</span>
              {data.emailVerified && <Chip>Verified</Chip>}
            </div>
            <small className="text-[0.78rem] text-muted">This is how you sign in, so it can&apos;t be changed. It is never shown to other people or companies.</small>
          </div>
          <List>
            <Item icon={data.method === "google" ? <User {...ICON} /> : data.method === "test" ? <KeyRound {...ICON} /> : <Mail {...ICON} />} {...signInRow(data)} action={<Chip>Connected</Chip>} />
          </List>
        </Section>

        <Section id="acc-data" title="Your data">
          <List>
            <Item
              icon={<Download {...ICON} />}
              title="Download your data"
              detail="Your account, resume profiles, gap results, paths, goals, proofs and ride days in one file. Your original resume file is never kept, so it isn't included."
              action={
                data.editable ? (
                  <a href="/api/account/export" download className={ghostSm}>
                    Download
                  </a>
                ) : (
                  <span className={`${ghostSm} opacity-60`} aria-disabled="true">
                    Download
                  </span>
                )
              }
            />
            <DeleteAccount editable={data.editable} icon={<Trash2 {...ICON} />} />
          </List>
        </Section>
      </div>
    </div>
  );
}

function signInRow(data: SettingsData): { title: string; detail: string } {
  if (data.method === "google") return { title: "Google", detail: `Signed in with Google as ${data.email}` };
  if (data.method === "test") return { title: "Test sign-in", detail: "A stand-in sign-in on preview links, until the real one is set up." };
  return { title: "Emailed code", detail: `We email a 6-digit code to ${data.email} each time you sign in. There is no password to remember.` };
}

function Section({ id, title, tag, children }: { id: string; title: string; tag?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-20 flex-col gap-4 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id={`${id}-h`} className="mr-auto text-[1.1rem] font-semibold">
          {title}
        </h2>
        {tag && <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">{children}</ul>;
}

function Item({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action: ReactNode }) {
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 min-[760px]:grid-cols-[34px_minmax(0,1fr)_auto]">
      <span className="grid size-[30px] place-items-center rounded-[10px] bg-surface-2 min-[760px]:size-[34px]">{icon}</span>
      <div className="min-w-0">
        <b className="text-[0.9rem] font-semibold">{title}</b>
        <small className="block text-[0.78rem] text-muted">{detail}</small>
      </div>
      <div className="col-start-2 justify-self-start min-[760px]:col-start-3">{action}</div>
    </li>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">{children}</span>;
}
