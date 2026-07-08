import { useState } from "react";
import { useFormContext } from "react-hook-form";

import AssignAllTeamMembers from "@calcom/features/eventtypes/components/AssignAllTeamMembers";
import {
  CheckedTeamSelect,
  type CheckedSelectOption,
} from "@calcom/features/eventtypes/components/CheckedTeamSelect";
import type { EventTypeSetupProps, FormValues } from "@calcom/features/eventtypes/lib/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { SchedulingType } from "@calcom/prisma/enums";
import { Label } from "@calcom/ui/components/form";

/**
 * Restores the event-type "Assignment" (Team) tab that was stubbed to `() => null`
 * in this cal.diy build. Lets you pick exactly which team members host a team event
 * (the (1,2) / (1,2,3) combinations) and, for round-robin, set per-host weights.
 * Persists via the `hosts` / `assignAllTeamMembers` form fields, which the event-type
 * update handler already writes to the DB.
 */
export default function EventTeamAssignmentTab({
  teamMembers,
}: {
  teamMembers: EventTypeSetupProps["teamMembers"];
  // Passed by the tab map but not needed here; kept optional so the call site type-checks.
  orgId?: number | null;
  team?: unknown;
  eventType?: unknown;
}) {
  const { t } = useLocale();
  const formMethods = useFormContext<FormValues>();

  const schedulingType = formMethods.watch("schedulingType");
  const hosts = formMethods.watch("hosts");
  const assignAllTeamMembers = formMethods.watch("assignAllTeamMembers");
  const [assignAll, setAssignAll] = useState(!!assignAllTeamMembers);

  const isCollective = schedulingType === SchedulingType.COLLECTIVE;
  const isRoundRobin = schedulingType === SchedulingType.ROUND_ROBIN;

  const memberLabel = (member: { name: string | null; email: string }) => member.name ?? member.email;

  const options: CheckedSelectOption[] = teamMembers.map((member) => ({
    value: String(member.id),
    label: memberLabel(member),
    avatar: member.avatar,
    groupId: null,
  }));

  const value: CheckedSelectOption[] = (hosts ?? []).map((host) => {
    const member = teamMembers.find((tm) => tm.id === host.userId);
    return {
      value: String(host.userId),
      label: member ? memberLabel(member) : String(host.userId),
      avatar: member?.avatar ?? "",
      priority: host.priority,
      weight: host.weight,
      isFixed: host.isFixed,
      groupId: host.groupId ?? null,
    };
  });

  const commitHosts = (selected: readonly CheckedSelectOption[]) => {
    formMethods.setValue(
      "hosts",
      selected.map((opt) => ({
        userId: parseInt(opt.value, 10),
        isFixed: isCollective ? true : opt.isFixed ?? false,
        priority: opt.priority ?? 2,
        weight: opt.weight ?? 100,
        scheduleId: null,
        groupId: opt.groupId ?? null,
      })),
      { shouldDirty: true }
    );
  };

  return (
    <div className="flex flex-col stack-y-6">
      <div>
        <Label className="mb-1">{t("scheduling_type")}</Label>
        <p className="text-subtle text-sm">
          {isCollective ? t("collective_description") : t("round_robin_description")}
        </p>
      </div>

      <AssignAllTeamMembers
        assignAllTeamMembers={assignAll}
        setAssignAllTeamMembers={setAssignAll}
        onActive={() => commitHosts(options)}
        onInactive={() => formMethods.setValue("hosts", [], { shouldDirty: true })}
      />

      {!assignAll && (
        <div>
          <Label>{t("team_members")}</Label>
          <CheckedTeamSelect
            options={options}
            value={value}
            groupId={null}
            isRRWeightsEnabled={isRoundRobin}
            onChange={commitHosts}
          />
        </div>
      )}
    </div>
  );
}
