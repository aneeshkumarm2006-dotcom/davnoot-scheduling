import process from "node:process";

import slugify from "@calcom/lib/slugify";
import { prisma } from "@calcom/prisma";
import { SchedulingType } from "@calcom/prisma/enums";

/**
 * Creates a TEAM event type (Round-Robin / Collective) with hosts attached.
 *
 * The open-source cal.diy edition's team event-type dialog is gated behind a PBAC
 * permission check that renders empty in this stripped build, so team events can't
 * reliably be made in the UI. This script writes the event type + Host rows directly,
 * matching what the create handler + editor would produce, so the RR/collective
 * booking engine has everything it needs. Companion to scripts/create-team.ts.
 *
 * Usage:
 *   yarn create-team-event --team davnoot-sales --title "Sales Intake" \
 *     --type round_robin --duration 30
 *
 * Flags:
 *   --team      Team slug (required; must already exist via create-team)
 *   --title     Event type title (required)
 *   --slug      URL slug (optional; defaults to slugify(title))
 *   --type      round_robin | collective   (default: round_robin)
 *   --duration  Length in minutes (default: 30)
 *   --hosts     Comma-separated member emails to assign (default: all accepted members)
 *   --dry-run   Print the plan without writing
 *
 * Idempotent: matched by (teamId, slug); re-running reuses the event type and re-syncs hosts.
 * Location is left empty on purpose — set it to Google Meet in the editor once Google Calendar
 * is connected.
 */

type ParsedArgs = Record<string, string | true>;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseEmails(value: string | true | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === true;

  const teamSlug = typeof args.team === "string" ? slugify(args.team) : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const slug = typeof args.slug === "string" ? slugify(args.slug) : slugify(title);
  const duration = typeof args.duration === "string" ? parseInt(args.duration, 10) : 30;

  const typeArg = (typeof args.type === "string" ? args.type : "round_robin").toLowerCase();
  const schedulingType =
    typeArg === "collective"
      ? SchedulingType.COLLECTIVE
      : typeArg === "round_robin" || typeArg === "roundrobin" || typeArg === "rr"
      ? SchedulingType.ROUND_ROBIN
      : null;

  if (!teamSlug || !title || !schedulingType || !Number.isFinite(duration)) {
    console.error(
      "❌ Missing/invalid flags.\n\n" +
        "   --team <slug>        (required)\n" +
        '   --title "Title"      (required)\n' +
        "   --type round_robin|collective   (default round_robin)\n" +
        "   --duration <minutes> (default 30)\n" +
        "   Optional: --slug, --hosts a@x,b@x, --dry-run"
    );
    process.exit(1);
  }

  const team = await prisma.team.findFirst({
    where: { slug: teamSlug, parentId: null },
    select: {
      id: true,
      name: true,
      members: {
        where: { accepted: true },
        select: { userId: true, user: { select: { email: true } } },
      },
    },
  });
  if (!team) {
    console.error(`❌ No team with slug "${teamSlug}". Create it first with: yarn create-team ...`);
    process.exit(1);
  }

  // Resolve hosts: explicit --hosts (intersected with team members) or all accepted members.
  const requested = parseEmails(args.hosts);
  const memberByEmail = new Map(team.members.map((m) => [m.user.email.toLowerCase(), m.userId]));
  let hostUserIds: number[];
  if (requested.length > 0) {
    hostUserIds = requested.map((e) => memberByEmail.get(e)).filter((id): id is number => id != null);
    const missing = requested.filter((e) => !memberByEmail.has(e));
    if (missing.length) console.warn(`⚠️  Not team members, skipped: ${missing.join(", ")}`);
  } else {
    hostUserIds = team.members.map((m) => m.userId);
  }
  if (hostUserIds.length === 0) {
    console.error("❌ No valid hosts to assign. Add members to the team first.");
    process.exit(1);
  }

  const isFixed = schedulingType === SchedulingType.COLLECTIVE; // collective = all hosts required

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Team "${team.name}" (#${team.id}) → ${schedulingType} event "${title}" ` +
      `(/${teamSlug}/${slug}, ${duration}m), ${hostUserIds.length} host(s)`
  );
  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  // Reuse by (teamId, slug); otherwise create.
  let eventType = await prisma.eventType.findFirst({ where: { teamId: team.id, slug } });
  if (eventType) {
    console.log(`↺ Reusing event type #${eventType.id}; re-syncing scheduling type + hosts`);
    await prisma.eventType.update({
      where: { id: eventType.id },
      data: { title, length: duration, schedulingType },
    });
  } else {
    eventType = await prisma.eventType.create({
      data: {
        title,
        slug,
        length: duration,
        schedulingType,
        locations: [], // set to Google Meet in the editor once Google Calendar is connected
        team: { connect: { id: team.id } },
      },
    });
    console.log(`🗓️  Created event type #${eventType.id}`);
  }

  // Sync hosts (idempotent): clear then recreate for this event type.
  await prisma.host.deleteMany({ where: { eventTypeId: eventType.id } });
  await prisma.host.createMany({
    data: hostUserIds.map((userId) => ({ userId, eventTypeId: eventType!.id, isFixed })),
  });

  console.log(`   👥 ${hostUserIds.length} host(s) assigned (isFixed=${isFixed})`);
  console.log(
    `\n✅ Done → ${process.env.NEXT_PUBLIC_WEBAPP_URL ?? ""}/team/${teamSlug}/${slug}\n` +
      "   Open it in Event Types → set Location to Google Meet after connecting Google Calendar."
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ create-team-event-type failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
