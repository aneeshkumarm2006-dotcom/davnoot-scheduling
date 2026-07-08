import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import dayjs from "@calcom/dayjs";
import { APP_NAME, WEBAPP_URL } from "@calcom/lib/constants";
import { serverConfig } from "@calcom/lib/serverConfig";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

/**
 * Lightweight meeting-reminder cron.
 *
 * The full Workflows feature (which drove reminders) was removed in this cal.diy build,
 * so this restores a basic "remind participants before the meeting" capability: it finds
 * confirmed bookings starting within the reminder window, emails every participant (organizer
 * + attendees) once — in their own timezone — and records the send in the booking metadata so
 * a booking is never reminded twice. Runs hourly via vercel.json.
 *
 * Auth: `CRON_API_KEY` (raw Authorization header / ?apiKey) or Vercel's `Bearer $CRON_SECRET`.
 * `?dryRun=1` reports what would send without sending or writing.
 */

const REMINDER_HOURS_BEFORE = parseInt(process.env.REMINDER_HOURS_BEFORE || "24", 10);

function extractJoinLink(booking: {
  location: string | null;
  references: { meetingUrl: string | null }[];
}): string | null {
  const ref = booking.references.find((r) => r.meetingUrl?.startsWith("http"));
  if (ref?.meetingUrl) return ref.meetingUrl;
  if (booking.location?.startsWith("http")) return booking.location;
  return null;
}

function reminderHtml(params: {
  title: string;
  whenLabel: string;
  joinLink: string | null;
  recipientName: string;
}) {
  const { title, whenLabel, joinLink, recipientName } = params;
  const button = joinLink
    ? `<p style="margin:24px 0"><a href="${joinLink}" style="background:#0B1220;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Join meeting</a></p>`
    : "";
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#101828;background:#f4f4f5;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <img src="${WEBAPP_URL}/emails/logo.png" alt="${APP_NAME}" height="36" style="height:36px;margin-bottom:16px"/>
    <h2 style="margin:0 0 8px;font-size:18px">Reminder: your meeting is coming up</h2>
    <p style="margin:0 0 4px;color:#475467">Hi ${recipientName || "there"},</p>
    <p style="margin:0 0 16px;color:#475467">This is a reminder for your upcoming meeting.</p>
    <p style="margin:0"><strong>${title}</strong></p>
    <p style="margin:4px 0 0;color:#475467">${whenLabel}</p>
    ${button}
    <p style="margin:24px 0 0;font-size:12px;color:#98a2b3">Sent by ${APP_NAME}</p>
  </div></body></html>`;
}

async function handler(request: NextRequest) {
  const apiKey = request.headers.get("authorization") || request.nextUrl.searchParams.get("apiKey");
  if (![process.env.CRON_API_KEY, `Bearer ${process.env.CRON_SECRET}`].includes(`${apiKey}`)) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = dayjs();
  const windowEnd = now.add(REMINDER_HOURS_BEFORE, "hour");

  const bookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.ACCEPTED,
      startTime: { gte: now.toDate(), lte: windowEnd.toDate() },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      location: true,
      metadata: true,
      user: { select: { name: true, email: true, timeZone: true } },
      attendees: { select: { name: true, email: true, timeZone: true } },
      references: { select: { meetingUrl: true } },
    },
  });

  const transporter = dryRun ? null : nodemailer.createTransport(serverConfig.transport);
  let sent = 0;
  const skipped: number[] = [];

  for (const booking of bookings) {
    const meta = (booking.metadata ?? {}) as Record<string, unknown>;
    if (meta.reminderSentAt) {
      skipped.push(booking.id);
      continue;
    }
    const joinLink = extractJoinLink(booking);

    const recipients = [
      ...(booking.user?.email
        ? [{ email: booking.user.email, name: booking.user.name ?? "", timeZone: booking.user.timeZone }]
        : []),
      ...booking.attendees.map((a) => ({ email: a.email, name: a.name, timeZone: a.timeZone })),
    ].filter((r) => !!r.email);

    if (!dryRun && transporter) {
      for (const r of recipients) {
        const whenLabel = `${dayjs(booking.startTime)
          .tz(r.timeZone || "UTC")
          .format("dddd, MMMM D, YYYY h:mm A")} (${r.timeZone || "UTC"})`;
        await transporter.sendMail({
          from: serverConfig.from,
          to: r.email,
          subject: `Reminder: ${booking.title}`,
          html: reminderHtml({ title: booking.title, whenLabel, joinLink, recipientName: r.name }),
          text: `Reminder: ${booking.title} — ${whenLabel}${joinLink ? ` — Join: ${joinLink}` : ""}`,
        });
      }
      await prisma.booking.update({
        where: { id: booking.id },
        data: { metadata: { ...meta, reminderSentAt: now.toISOString() } },
      });
    }
    sent++;
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    windowHours: REMINDER_HOURS_BEFORE,
    remindersProcessed: sent,
    alreadyReminded: skipped.length,
    candidates: bookings.length,
  });
}

export const GET = defaultResponderForAppDir(handler);
