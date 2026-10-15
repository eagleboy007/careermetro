import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { FindPeople } from "@/components/corporate/find-people";
import { exampleFindPeople, exampleFoundPerson } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { findPeoplePage } from "@/lib/corporate/find-store";
import { findSearchFromParams } from "@/lib/schemas";
import { openFoundPersonAction, searchPeopleAction, sendFoundRequestAction } from "./actions";
import { NoCompanyRole } from "../no-role";

export const metadata: Metadata = { title: "Find people · Corporate · CareerMetro", robots: { index: false } };

/*
 * Corporate > Find people (pending item 19), at `/corporate/people?job=…&band=…&role=…&verified=1&page=…`: the address
 * holds only a job id, the filters picked from fixed choices (T44) and a page, never anything typed or personal. Opening it fills in the form; the search itself
 * runs only when Search is pressed (a server action, Testing T41). The person's live company role, job team and the
 * company's state are read on every request. Without accounts (the example preview) it shows example data where
 * nothing is sent.
 */
async function People({ searchParams }: PageProps<"/corporate/people">) {
  await connection();
  const params = findSearchFromParams(await searchParams);
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) return <FindPeople view={exampleFindPeople} example={exampleFoundPerson} />;
  const view = await findPeoplePage(account.id, params);
  if (!view) {
    return <NoCompanyRole userId={account.id} />;
  }
  return <FindPeople view={view} actions={{ search: searchPeopleAction, open: openFoundPersonAction, request: sendFoundRequestAction }} />;
}

export default function PeoplePage(props: PageProps<"/corporate/people">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <People {...props} />
    </Suspense>
  );
}
