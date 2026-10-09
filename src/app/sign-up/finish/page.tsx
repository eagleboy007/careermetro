import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { findAccount } from "@/lib/account/store";
import { safeNext } from "@/lib/auth/config";
import { currentIdentity } from "@/lib/auth/server";
import { FinishForm } from "./finish-form";

export const metadata: Metadata = { title: "Create your account · CareerMetro", robots: { index: false } };

async function Finish({ searchParams }: PageProps<"/sign-up/finish">) {
  await connection();
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  const identity = await currentIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (await findAccount(identity.subject)) redirect(next);
  return (
    <>
      <p className="text-muted">
        Signed in as <strong className="font-medium text-ink">{identity.email}</strong>. One last step.
      </p>
      <FinishForm next={next} name={identity.name} />
    </>
  );
}

export default function FinishPage(props: PageProps<"/sign-up/finish">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <h1 className="text-4xl font-semibold leading-[1.05]">Create your account</h1>
        <Suspense>
          <Finish {...props} />
        </Suspense>
      </div>
    </div>
  );
}
