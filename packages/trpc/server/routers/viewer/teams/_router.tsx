import { z } from "zod";

import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { TRPCError } from "@trpc/server";

import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";

/**
 * Team management router.
 *
 * The upstream cal.diy `viewer.teams` router was removed in the closed-source split.
 * This restores the essentials needed to run self-hosted teams: list your teams, view
 * members, and (as an OWNER/ADMIN) add existing users, change their role, or remove them.
 * Members are added by email against already-registered accounts — the email-invite/token
 * flow for not-yet-registered users can be layered on later.
 */

async function getMembership(userId: number, teamId: number) {
  return prisma.membership.findFirst({
    where: { userId, teamId, accepted: true },
    select: { role: true },
  });
}

async function assertAdmin(userId: number, teamId: number) {
  const membership = await getMembership(userId, teamId);
  if (!membership || (membership.role !== MembershipRole.OWNER && membership.role !== MembershipRole.ADMIN)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You must be a team admin or owner to do that." });
  }
  return membership;
}

async function assertMember(userId: number, teamId: number) {
  const membership = await getMembership(userId, teamId);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this team." });
  }
  return membership;
}

export const teamsRouter = router({
  /**
   * People the current user can build a dynamic group link with (`/alice+bob`).
   * Dynamic booking resolves people by username and isn't team-scoped, so this
   * returns every user who has a username and hasn't opted out of dynamic booking.
   */
  listBookableUsers: authedProcedure.query(async ({ ctx }) => {
    const select = { id: true, name: true, username: true, avatarUrl: true } as const;
    const [me, users] = await Promise.all([
      prisma.user.findUnique({ where: { id: ctx.user.id }, select }),
      prisma.user.findMany({
        where: {
          username: { not: null },
          allowDynamicBooking: { not: false },
          NOT: { id: ctx.user.id },
        },
        select,
        orderBy: { name: "asc" },
      }),
    ]);
    return { me, users };
  }),

  // Teams the current user belongs to, with their role.
  list: authedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: ctx.user.id, accepted: true, team: { isOrganization: false } },
      select: { role: true, team: { select: { id: true, name: true, slug: true } } },
      orderBy: { teamId: "asc" },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      role: m.role,
    }));
  }),

  // Members of a given team (any member may view).
  getMembers: authedProcedure.input(z.object({ teamId: z.number() })).query(async ({ ctx, input }) => {
    await assertMember(ctx.user.id, input.teamId);
    const members = await prisma.membership.findMany({
      where: { teamId: input.teamId },
      select: {
        role: true,
        accepted: true,
        user: { select: { id: true, name: true, email: true, username: true, avatarUrl: true } },
      },
      orderBy: { id: "asc" },
    });
    return members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      accepted: m.accepted,
    }));
  }),

  // Add an existing user (by email) to the team.
  addMember: authedProcedure
    .input(
      z.object({
        teamId: z.number(),
        email: z.string().email(),
        role: z.nativeEnum(MembershipRole).default(MembershipRole.MEMBER),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertAdmin(ctx.user.id, input.teamId);
      const user = await prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No account with that email yet. Ask them to sign up first, then add them.",
        });
      }
      await prisma.membership.upsert({
        where: { userId_teamId: { userId: user.id, teamId: input.teamId } },
        update: { role: input.role, accepted: true },
        create: { userId: user.id, teamId: input.teamId, role: input.role, accepted: true },
      });
      return { success: true };
    }),

  // Change a member's role.
  updateMemberRole: authedProcedure
    .input(z.object({ teamId: z.number(), userId: z.number(), role: z.nativeEnum(MembershipRole) }))
    .mutation(async ({ ctx, input }) => {
      await assertAdmin(ctx.user.id, input.teamId);
      // Don't allow demoting the last owner.
      if (input.role !== MembershipRole.OWNER) {
        const owners = await prisma.membership.count({
          where: { teamId: input.teamId, role: MembershipRole.OWNER, accepted: true },
        });
        const target = await getMembership(input.userId, input.teamId);
        if (owners <= 1 && target?.role === MembershipRole.OWNER) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A team must have at least one owner." });
        }
      }
      await prisma.membership.update({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        data: { role: input.role },
      });
      return { success: true };
    }),

  // Remove a member from the team.
  removeMember: authedProcedure
    .input(z.object({ teamId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertAdmin(ctx.user.id, input.teamId);
      const target = await getMembership(input.userId, input.teamId);
      if (target?.role === MembershipRole.OWNER) {
        const owners = await prisma.membership.count({
          where: { teamId: input.teamId, role: MembershipRole.OWNER, accepted: true },
        });
        if (owners <= 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Can't remove the last owner." });
        }
      }
      await prisma.membership.delete({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      return { success: true };
    }),
});
