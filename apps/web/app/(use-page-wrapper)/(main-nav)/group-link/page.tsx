import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";

import GroupLinkView from "~/group-link/group-link-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("group_link"),
    () => "Create a booking link with your teammates",
    undefined,
    undefined,
    "/group-link"
  );

const Page = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login?callbackUrl=/group-link");
  }
  return <GroupLinkView />;
};

export default Page;
