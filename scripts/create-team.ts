import process from "node:process";

import slugify from "@calcom/lib/slugify";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

/**
 * Repeatable team-provisioning script for self-hosted cal.diy.
 *
 * The open-source cal.diy edition ships the Team/Membership data model and the
 * RR/collective booking engine, but the web UI + `viewer.teams` tRPC router that
 * used to create/manage teams was removed in the closed-source split. This script
 * fills that gap: it creates a team and attaches existing users as accepted members
 * so that the surviving event-types UI can build ROUND_ROBIN/COLLECTIVE team events.
 *
 * Usage:
 *   yarn ts-node --transpile-only scripts/create-team.ts \
 *     --name "Davnoot Sales" --owner prem@davnoot.com \
 *     --admins alice@davnoot.com --members bob@davnoot.com,carol@davnoot.com
 *
 * Flags:
 *   --name      Team display name (required)
 *   --slug      URL slug (optional; defaults to slugify(name))
 *   --owner     Email of the team OWNER (required; must be an existing user)
 *   --admins    Comma-separated emails to add as ADMIN (optional)
 *   --members   Comma-separated emails to add as MEMBER (optional)
 *   --dry-run   Print what would happen without writing anything
 *
 * Safe to re-run: the team is matched by slug, memberships are upserted by
 * (userId, teamId), so nothing is duplicated.
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

/** OWNER outranks ADMIN outranks MEMBER when the same email appears in multiple flags. */
const ROLE_RANK: Record<MembershipRole, number> = {
  [MembershipRole.OWNER]: 3,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.MEMBER]: 1,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === true;

  const name = typeof args.name === "string" ? args.name.trim() : "";
  const ownerEmail = typeof args.owner === "string" ? args.owner.trim().toLowerCase() : "";
  const slug = typeof args.slug === "string" ? slugify(args.slug) : slugify(name);

  if (!name || !ownerEmail) {
    console.error(
      "❌ Missing required flags.\n\n" +
        '   --name "Team Name"   (required)\n' +
        "   --owner email        (required)\n\n" +
        "   Optional: --slug, --admins a@x,b@x, --members c@x,d@x, --dry-run"
    );
    process.exit(1);
  }

  // Build desired role map with precedence, owner wins.
  const desiredRole = new Map<string, MembershipRole>();
  const assign = (email: string, role: MembershipRole) => {
    const existing = desiredRole.get(email);
    if (!existing || ROLE_RANK[role] > ROLE_RANK[existing]) desiredRole.set(email, role);
  };
  assign(ownerEmail, MembershipRole.OWNER);
  for (const email of parseEmails(args.admins)) assign(email, MembershipRole.ADMIN);
  for (const email of parseEmails(args.members)) assign(email, MembershipRole.MEMBER);

  const emails = [...desiredRole.keys()];

  // Resolve emails to existing users (case-insensitive). We never create users here —
  // membership without a real user is meaningless; missing users are reported and skipped.
  const users = await prisma.user.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
    select: { id: true, email: true, username: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const missing = emails.filter((email) => !userByEmail.has(email));
  if (missing.length > 0) {
    console.warn(`⚠️  ${missing.length} email(s) have no matching user and will be skipped:`);
    for (const email of missing) console.warn(`      - ${email}`);
  }

  if (!userByEmail.has(ownerEmail)) {
    console.error(`❌ Owner ${ownerEmail} is not an existing user. Create the account first, then re-run.`);
    process.exit(1);
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Team: "${name}"  slug: "${slug}"`);

  if (dryRun) {
    console.log("Would create/reuse the team and set these memberships:");
    for (const [email, role] of desiredRole) {
      const user = userByEmail.get(email);
      console.log(`   ${user ? "✓" : "✗ (missing, skip)"}  ${email} → ${role}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Find top-level team by slug (Team is unique on [slug, parentId]); reuse if present.
  let team = await prisma.team.findFirst({ where: { slug, parentId: null } });
  if (team) {
    console.log(`↺ Reusing existing team #${team.id} ("${team.name}")`);
  } else {
    team = await prisma.team.create({ data: { name, slug } });
    console.log(`🏢 Created team #${team.id} → ${process.env.NEXT_PUBLIC_WEBAPP_URL ?? ""}/team/${slug}`);
  }

  let added = 0;
  for (const [email, role] of desiredRole) {
    const user = userByEmail.get(email);
    if (!user) continue;
    await prisma.membership.upsert({
      where: { userId_teamId: { userId: user.id, teamId: team.id } },
      update: { role, accepted: true },
      create: { userId: user.id, teamId: team.id, role, accepted: true },
    });
    added++;
    console.log(`   👤 ${email} → ${role}`);
  }

  console.log(`\n✅ Done. Team #${team.id} has ${added} member(s) synced.`);
  console.log(
    "   Next: open the app → Event Types → the team now appears as a profile → " +
      'create a "team event type" with Round-Robin or Collective scheduling.'
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ create-team failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
