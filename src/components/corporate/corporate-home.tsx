import { Building2, CalendarClock, ExternalLink, KeyRound, MessageSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { CorporateHomeView, JobListActions, JoinActions, TeamActions } from "@/lib/corporate/types";
import { ORG_ROLE_LABELS, ORG_TYPE_LABELS, SIGNUP_CLOSED_TEXT } from "@/lib/schemas/constants";
import { JobsPanel } from "./jobs-panel";
import { JoinForm } from "./join-form";
import { AntiScamLine, ghostSm, ICON, OrgStatusBadge, Panel, SecondAdminBanner } from "./parts";
import { TeamAccess } from "./team-access";

/**
 * Corporate home for a member (dev/corporate-plan.md, build steps 1 to 3): the company, its status badge, the
 * second-admin banner, the anti-scam line, Jobs and, for Recruiter admins, Team and access. Applications and chats
 * come in later steps.
 */
export function CorporateHome({ view, actions, jobActions, note }: { view: CorporateHomeView; actions?: TeamActions; jobActions?: JobListActions; note?: ReactNode }) {
  const { org, me } = view;
  const admin = me.role === "admin";
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      {note}
      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-md bg-ink font-display text-xl font-semibold text-bg">
          {org.name.trim()[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Corporate · {ORG_TYPE_LABELS[org.type]}</span>
          <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1] [overflow-wrap:anywhere]">{org.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[0.84rem] text-muted">
            <OrgStatusBadge status={org.status} />
            <span>
              {ORG_ROLE_LABELS[me.role]} since {formatDay(me.since)}
            </span>
          </div>
        </div>
        <Link href="/corporate/messages" className={`${ghostSm} min-h-11`}>
          <MessageSquare {...ICON} />
          Messages
        </Link>
        <Link href="/corporate/interviews" className={`${ghostSm} min-h-11`}>
          <CalendarClock {...ICON} />
          Interviews
        </Link>
        {org.website && (
          <a href={org.website} target="_blank" rel="noopener noreferrer" className={`${ghostSm} min-h-11`}>
            <ExternalLink {...ICON} />
            Website
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>

      {org.status === "pending" && (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] text-muted">
          We check every new company by hand before its jobs go live, usually within one working day. Meanwhile you can set up your team.
        </p>
      )}
      {org.status === "suspended" && (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] text-muted">
          This company is suspended while we review it. Its jobs and messages are paused. Write to us from the Grievances page if you think this is a mistake.
        </p>
      )}

      {view.secondAdminDaysLeft !== null && admin && <SecondAdminBanner daysLeft={view.secondAdminDaysLeft} action={<a href="#team" className={ghostSm}>Add an admin</a>} />}
      {view.secondAdminDaysLeft !== null && !admin && view.secondAdminDaysLeft === 0 && (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] text-muted">New jobs can&apos;t open until the company has a second Recruiter admin.</p>
      )}

      <AntiScamLine />

      <Panel id="jobs" title="Jobs">
        <JobsPanel jobs={view.jobs} actions={jobActions} />
      </Panel>

      {view.team ? (
        <Panel id="team" title="Team and access" tag="admins only">
          <p className="-mt-2 text-[0.86rem] text-muted">
            Everyone here signs in with their own CareerMetro account. Access is a role on that account, and it starts after they confirm a work email on{" "}
            <span className="font-mono">{org.domain}</span>.
          </p>
          <TeamAccess domain={org.domain} members={view.team.members} invites={view.team.invites} requests={view.team.requests} actions={actions} />
        </Panel>
      ) : (
        <Panel id="team" title="Your access">
          <p className="text-[0.9rem] text-muted">
            You are {ORG_ROLE_LABELS[me.role]} at {org.name}. A Recruiter admin manages the team. If they remove your role, Corporate closes for you and your own CareerMetro account stays as it is.
          </p>
        </Panel>
      )}
    </div>
  );
}

/**
 * Corporate for someone with no company role: set up a company, or confirm a role a Recruiter admin gave them. While
 * codes can't be delivered (production without an email sender) it says sign-up opens soon.
 */
export function CorporateStart({ open, joinActions }: { open: boolean; joinActions?: JoinActions }) {
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Corporate · for employers</span>
        <h1 className="mt-1.5 text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Hire on CareerMetro</h1>
        <p className="mt-1.5 max-w-[620px] text-[0.95rem] text-muted">
          Companies post jobs and see only the people who apply to them here. Your own CareerMetro account stays as it is, and a company never sees it.
        </p>
      </div>
      {!open ? (
        <p role="status" className="rounded-md bg-surface-2 px-3.5 py-3 text-[0.95rem]">
          {SIGNUP_CLOSED_TEXT}
        </p>
      ) : (
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <Panel id="setup" title="Set up your company">
            <p className="text-[0.9rem] text-muted">Company name, website and your work email on the company&apos;s domain. You become its first Recruiter admin. Free during the beta.</p>
            <div>
              <Link href="/corporate/new" className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90">
                <Building2 {...ICON} />
                Set up your company
              </Link>
            </div>
          </Panel>
          <Panel id="join" title="Confirm a role you were given">
            <p className="flex items-start gap-2 text-[0.9rem] text-muted">
              <KeyRound {...ICON} className="mt-1 shrink-0" />A Recruiter admin added your work email? Confirm it with a code and your role switches on.
            </p>
            <JoinForm actions={joinActions} />
          </Panel>
        </div>
      )}
      <AntiScamLine />
    </div>
  );
}
