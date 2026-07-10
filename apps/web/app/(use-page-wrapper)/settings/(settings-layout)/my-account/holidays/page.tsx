import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";

import { HolidaysView } from "~/settings/my-account/holidays-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("holidays"),
    () => "Automatically block public holidays on your calendar",
    undefined,
    undefined,
    "/settings/my-account/holidays"
  );

const Page = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login?callbackUrl=/settings/my-account/holidays");
  }
  return <HolidaysView />;
};

export default Page;
