import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { authConfig, safeNext } from "@/lib/auth/config";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · CareerMetro", robots: { index: false } };

const ERRORS: Record<string, string> = {
  link: "That sign-in link didn't work. It may have expired or been used already. Please try again.",
  google: "We couldn't reach Google just now. Please try again, or use your email.",
};

async function SignIn({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(params.next));
  const error = ERRORS[one(params.error) ?? ""] ?? null;
  if (!authConfig()) {
    return <p className="rounded-lg border border-line bg-surface p-5 text-sm">Sign-in isn&apos;t switched on yet. Please check back soon.</p>;
  }
  return <SignInForm next={next} error={error} />;
}

export default function SignInPage(props: PageProps<"/sign-in">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold leading-[1.05]">Sign in</h1>
          <p className="text-muted">New here? The same steps create your account. Your gaps and path are kept, and only you can see them.</p>
        </section>
        <Suspense>
          <SignIn {...props} />
        </Suspense>
        <p className="text-sm text-muted">
          Just looking?{" "}
          <Link href="/start" className="underline underline-offset-2 hover:text-ink">
            Try it without an account
          </Link>
          . We keep that analysis for 24 hours.
        </p>
      </div>
    </div>
  );
}
