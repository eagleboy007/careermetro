import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { BuilderView } from "@/components/builder/builder-view";
import { displayName } from "@/lib/account/name";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleBuilder } from "@/lib/builder/fixtures";
import { builderRoleLinks as roleLinks, builderRoles as roles, builderRoleTools as roleTools } from "@/lib/builder/roles";
import { loadDraft } from "@/lib/builder/store";
import { checkMyGaps, reviewBuiltResume, saveBuilderDraft } from "./actions";

export const metadata: Metadata = { title: "Build your resume · CareerMetro", robots: { index: false } };

/** Build your resume (FR-36, handoff 12k). Without accounts (the example preview) it shows example answers and saves nothing. */
async function Builder() {
  await connection();
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) return <BuilderView data={{ ...exampleBuilder, roles, roleTools, roleLinks }} />;
  const { answers } = await loadDraft(account.id);
  return (
    <BuilderView
      data={{ answers, name: displayName(account.name), roles, roleTools, roleLinks }}
      actions={{ save: saveBuilderDraft, review: reviewBuiltResume, gaps: checkMyGaps }}
    />
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Builder />
    </Suspense>
  );
}
