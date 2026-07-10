"use client";

import { useState } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { MembershipRole } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { showToast } from "@calcom/ui/components/toast";

const ROLES: MembershipRole[] = [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER];

export default function TeamsView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const teamsQuery = trpc.viewer.teams.list.useQuery();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const teamId = selectedTeamId ?? teamsQuery.data?.[0]?.id ?? null;

  const membersQuery = trpc.viewer.teams.getMembers.useQuery(
    { teamId: teamId as number },
    { enabled: teamId != null }
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>(MembershipRole.MEMBER);

  const refresh = () => utils.viewer.teams.getMembers.invalidate();

  // Accept one email or a pasted list (commas, semicolons, spaces or newlines).
  const parsedEmails = email
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));

  const addMembers = trpc.viewer.teams.addMembers.useMutation({
    onSuccess: ({ added, notFound }) => {
      if (added > 0) showToast(`Added ${added} member${added === 1 ? "" : "s"}`, "success");
      if (notFound.length > 0) {
        showToast(`No account yet (ask them to sign in first): ${notFound.join(", ")}`, "warning");
      }
      if (added > 0) setEmail("");
      refresh();
    },
    onError: (e) => showToast(e.message, "error"),
  });
  const updateRole = trpc.viewer.teams.updateMemberRole.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => showToast(e.message, "error"),
  });
  const removeMember = trpc.viewer.teams.removeMember.useMutation({
    onSuccess: () => {
      showToast(t("member_removed") || "Member removed", "success");
      refresh();
    },
    onError: (e) => showToast(e.message, "error"),
  });

  if (teamsQuery.isPending) {
    return <div className="p-6 text-subtle">{t("loading")}</div>;
  }
  if (!teamsQuery.data || teamsQuery.data.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-emphasis text-xl font-semibold">{t("teams")}</h1>
        <p className="text-subtle mt-2 text-sm">
          You are not an admin or owner of any team yet. Create one with the{" "}
          <code>yarn create-team</code> script, then manage members here.
        </p>
      </div>
    );
  }

  const currentTeam = teamsQuery.data.find((team) => team.id === teamId) ?? teamsQuery.data[0];
  const isAdmin = currentTeam.role === MembershipRole.OWNER || currentTeam.role === MembershipRole.ADMIN;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-emphasis text-xl font-semibold">{t("teams")}</h1>

      {/* Team selector */}
      {teamsQuery.data.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {teamsQuery.data.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                team.id === currentTeam.id ? "border-emphasis bg-emphasis" : "border-subtle"
              }`}>
              {team.name}
            </button>
          ))}
        </div>
      )}

      {/* Add member */}
      {isAdmin && teamId != null && (
        <div className="border-subtle mt-6 rounded-lg border p-4">
          <h2 className="text-emphasis text-sm font-medium">{t("add_team_member") || "Add members"}</h2>
          <p className="text-subtle mb-3 text-xs">
            Paste one or many emails (commas, spaces or new lines). They must have signed in at least once.
          </p>
          <textarea
            className="border-default bg-default text-default min-h-20 w-full rounded-md border p-2 text-sm"
            placeholder={"alice@davnoot.com, bob@davnoot.com\ncarol@davnoot.com"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-emphasis mb-2 block text-sm font-medium">{t("role")}</label>
              <select
                className="border-default bg-default text-default h-9 rounded-md border px-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as MembershipRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(r.toLowerCase()) || r}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={parsedEmails.length === 0 || addMembers.isPending}
              onClick={() =>
                teamId != null && addMembers.mutate({ teamId, emails: parsedEmails, role })
              }>
              {parsedEmails.length > 1 ? `${t("add")} ${parsedEmails.length}` : t("add")}
            </Button>
          </div>
        </div>
      )}

      {/* Members list */}
      <div className="border-subtle mt-6 overflow-hidden rounded-lg border">
        <div className="border-subtle border-b px-4 py-2">
          <h2 className="text-emphasis text-sm font-medium">{t("team_members")}</h2>
        </div>
        {membersQuery.isPending ? (
          <div className="text-subtle p-4 text-sm">{t("loading")}</div>
        ) : (
          <ul className="divide-subtle divide-y">
            {membersQuery.data?.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-emphasis truncate text-sm font-medium">
                    {member.name || member.email}
                    {!member.accepted && (
                      <span className="text-subtle ml-2 text-xs">({t("pending") || "pending"})</span>
                    )}
                  </p>
                  <p className="text-subtle truncate text-xs">{member.email}</p>
                </div>
                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      className="border-default bg-default text-default h-8 rounded-md border px-2 text-sm"
                      value={member.role}
                      onChange={(e) =>
                        teamId != null &&
                        updateRole.mutate({
                          teamId,
                          userId: member.userId,
                          role: e.target.value as MembershipRole,
                        })
                      }>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(r.toLowerCase()) || r}
                        </option>
                      ))}
                    </select>
                    <Button
                      color="destructive"
                      variant="icon"
                      StartIcon="trash"
                      onClick={() =>
                        teamId != null && removeMember.mutate({ teamId, userId: member.userId })
                      }
                    />
                  </div>
                ) : (
                  <span className="text-subtle text-xs">{t(member.role.toLowerCase()) || member.role}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
