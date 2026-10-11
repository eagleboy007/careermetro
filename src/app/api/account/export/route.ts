import { exportAccountData } from "@/lib/account/export";
import { currentAccount } from "@/lib/auth/server";

/** "Download your data" in Account settings: one JSON file with everything we hold about the signed-in person. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ ok: false, message: "Please sign in to download your data." }, { status: 401 });
  const data = await exportAccountData(account.id);
  if (!data) return Response.json({ ok: false, message: "Please sign in to download your data." }, { status: 401 });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="careermetro-data-${day}.json"`,
      // Personal data: never kept by a browser cache or a shared proxy.
      "cache-control": "no-store, private",
    },
  });
}
