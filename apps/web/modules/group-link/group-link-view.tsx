"use client";

import { useMemo, useState } from "react";

import dayjs from "@calcom/dayjs";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { showToast } from "@calcom/ui/components/toast";

/**
 * Group scheduler (`/group-link`).
 *
 * Tick the people who should be in the meeting and the page shows — right here in the
 * dashboard — only the times when *everyone* is free. Dynamic booking intersects every
 * listed person's calendar and availability, so a slot only appears if all of them are open.
 *
 * Two ways to use it:
 *   - Click a slot to book it yourself (opens the booking screen with the time pre-filled).
 *   - Copy the link and send it to a client so they pick a time.
 */
// Must match the dynamic event's multipleDuration options in defaultEvents.ts
const DURATIONS = [15, 30, 45, 60, 90];
const DEFAULT_DURATION = 30;

export default function GroupLinkView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, isPending } = trpc.viewer.teams.listBookableUsers.useQuery();
  const templates = trpc.viewer.teams.groupLinkTemplates.useQuery();
  const saveTemplate = trpc.viewer.teams.saveGroupLinkTemplate.useMutation({
    onSuccess: () => {
      utils.viewer.teams.groupLinkTemplates.invalidate();
      showToast("Template saved", "success");
    },
  });
  const deleteTemplate = trpc.viewer.teams.deleteGroupLinkTemplate.useMutation({
    onSuccess: () => utils.viewer.teams.groupLinkTemplates.invalidate(),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [includeToday, setIncludeToday] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [excludedRanges, setExcludedRanges] = useState<{ from: string; to: string }[]>([]);
  const [excludeFrom, setExcludeFrom] = useState("");
  const [excludeTo, setExcludeTo] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const meUsername = data?.me?.username ?? null;
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );

  const usernameList = useMemo(
    () => (meUsername ? [meUsername, ...selected] : []),
    [meUsername, selected]
  );

  // Individual YYYY-MM-DD dates covered by the excluded ranges (capped so a
  // stray far-future range can't blow up the URL).
  const excludedDates = useMemo(() => {
    const dates = new Set<string>();
    for (const range of excludedRanges) {
      let day = dayjs(range.from);
      const end = dayjs(range.to);
      while ((day.isBefore(end) || day.isSame(end, "day")) && dates.size < 120) {
        dates.add(day.format("YYYY-MM-DD"));
        day = day.add(1, "day");
      }
    }
    return Array.from(dates).sort();
  }, [excludedRanges]);

  const addExcludedRange = () => {
    if (!excludeFrom) return;
    let from = excludeFrom;
    let to = excludeTo || excludeFrom;
    if (to < from) [from, to] = [to, from];
    setExcludedRanges((prev) =>
      prev.some((r) => r.from === from && r.to === to) ? prev : [...prev, { from, to }]
    );
    setExcludeFrom("");
    setExcludeTo("");
  };

  const formatRange = (range: { from: string; to: string }) =>
    range.from === range.to
      ? dayjs(range.from).format("MMM D")
      : `${dayjs(range.from).format("MMM D")} – ${dayjs(range.to).format("MMM D")}`;

  // lockDuration=1 hides the duration switcher on the public booking page so
  // clients can only book the length chosen here. Same-day slots are hidden
  // by default; allowToday=1 opts this specific link back in. A meeting name
  // rides along as title=... and is fixed — the booker can't change it.
  const link = useMemo(() => {
    if (!meUsername || selected.length === 0) return null;
    const todayParam = includeToday ? "&allowToday=1" : "";
    const titleParam = meetingTitle.trim()
      ? `&title=${encodeURIComponent(meetingTitle.trim())}`
      : "";
    const excludeParam = excludedDates.length ? `&excludeDates=${excludedDates.join(",")}` : "";
    return `${origin}/${usernameList.join("+")}?duration=${duration}&lockDuration=1${todayParam}${titleParam}${excludeParam}`;
  }, [
    origin,
    meUsername,
    selected.length,
    usernameList,
    duration,
    includeToday,
    meetingTitle,
    excludedDates,
  ]);

  const applyTemplate = (template: {
    name: string;
    usernames: string[];
    duration: number;
    includeToday?: boolean;
    title?: string;
  }) => {
    const known = new Set((data?.users ?? []).map((u) => u.username as string));
    const missing = template.usernames.filter((u) => !known.has(u));
    setSelected(template.usernames.filter((u) => known.has(u)));
    setDuration(template.duration);
    setIncludeToday(!!template.includeToday);
    setMeetingTitle(template.title ?? "");
    setTemplateName(template.name);
    if (missing.length > 0) {
      showToast(`Skipped unknown member(s): ${missing.join(", ")}`, "warning");
    }
  };

  // Look two weeks ahead for openings.
  const timeWindow = useMemo(() => {
    const start = dayjs().startOf("day");
    return { startTime: start.toISOString(), endTime: start.add(14, "day").endOf("day").toISOString() };
  }, []);

  const schedule = trpc.viewer.slots.getSchedule.useQuery(
    {
      usernameList,
      eventTypeSlug: "dynamic",
      isTeamEvent: false,
      startTime: timeWindow.startTime,
      endTime: timeWindow.endTime,
      timeZone,
      duration: String(duration),
      ...(includeToday ? { allowSameDay: true } : {}),
      ...(excludedDates.length ? { excludeDates: excludedDates } : {}),
    },
    {
      enabled: selected.length > 0 && !!meUsername,
      trpc: { context: { skipBatch: true } },
    }
  );

  const days = useMemo(() => {
    const slots = schedule.data?.slots ?? {};
    return Object.keys(slots)
      .sort()
      .map((date) => ({ date, times: slots[date] ?? [] }))
      .filter((d) => d.times.length > 0);
  }, [schedule.data]);

  const toggle = (username: string) =>
    setSelected((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );

  const bookHref = (iso: string) => {
    const d = dayjs(iso).tz(timeZone);
    const params = new URLSearchParams({
      month: d.format("YYYY-MM"),
      date: d.format("YYYY-MM-DD"),
      slot: iso,
      duration: String(duration),
      ...(includeToday ? { allowToday: "1" } : {}),
      ...(meetingTitle.trim() ? { title: meetingTitle.trim() } : {}),
      ...(excludedDates.length ? { excludeDates: excludedDates.join(",") } : {}),
    });
    return `${origin}/${usernameList.join("+")}?${params.toString()}`;
  };

  if (isPending) return <div className="text-subtle p-6">{t("loading")}</div>;

  if (!meUsername) {
    return (
      <div className="p-6">
        <h1 className="text-emphasis text-xl font-semibold">Group link</h1>
        <p className="text-subtle mt-2 text-sm">
          You need a username on your profile before you can create group links.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-emphasis text-xl font-semibold">Group link</h1>
      <p className="text-subtle mt-1 text-sm">
        Pick who should be in the meeting. You&apos;ll only see times when{" "}
        <strong>everyone is free</strong> — all calendars are checked automatically.
      </p>

      {/* Saved templates */}
      {(templates.data?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="text-emphasis text-sm font-medium">Templates</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.data?.map((template) => (
              <span
                key={template.name}
                className="border-default bg-default inline-flex items-center gap-1 rounded-md border pl-3 pr-1 text-sm">
                <button
                  type="button"
                  className="text-emphasis py-1.5 hover:underline"
                  onClick={() => applyTemplate(template)}>
                  {template.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete template ${template.name}`}
                  className="text-subtle hover:text-emphasis px-1.5 py-1.5"
                  onClick={() => deleteTemplate.mutate({ name: template.name })}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* People picker */}
      <div className="border-subtle mt-6 overflow-hidden rounded-lg border">
        <div className="border-subtle bg-muted border-b px-4 py-2">
          <p className="text-emphasis text-sm font-medium">Who&apos;s in the meeting?</p>
        </div>
        <ul className="divide-subtle divide-y">
          <li className="flex items-center justify-between px-4 py-3">
            <span className="text-emphasis text-sm font-medium">
              {data?.me?.name || meUsername} <span className="text-subtle">(you)</span>
            </span>
            <span className="text-subtle text-xs">always included</span>
          </li>
          {data?.users.map((user) => {
            const username = user.username as string;
            const checked = selected.includes(username);
            return (
              <li key={user.id} className="flex items-center justify-between px-4 py-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={checked}
                    onChange={() => toggle(username)}
                  />
                  <span className="text-emphasis text-sm">{user.name || username}</span>
                  <span className="text-subtle text-xs">@{username}</span>
                </label>
              </li>
            );
          })}
          {data?.users.length === 0 && (
            <li className="text-subtle px-4 py-3 text-sm">No other people have set up a username yet.</li>
          )}
        </ul>
      </div>

      {/* Duration picker */}
      {selected.length > 0 && (
        <div className="mt-6 flex items-center gap-2">
          <span className="text-emphasis text-sm font-medium">How long?</span>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setDuration(mins)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  duration === mins
                    ? "border-emphasis bg-emphasis text-emphasis font-semibold"
                    : "border-default bg-default text-default hover:border-emphasis"
                }`}>
                {mins}m
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Same-day opt-in */}
      {selected.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded"
            checked={includeToday}
            onChange={() => setIncludeToday((v) => !v)}
          />
          <span className="text-emphasis text-sm">Include today&apos;s availability</span>
          <span className="text-subtle text-xs">(off = earliest bookable day is tomorrow)</span>
        </label>
      )}

      {/* Meeting name (fixed for the booker) */}
      {selected.length > 0 && (
        <div className="mt-3">
          <label className="text-emphasis text-sm font-medium" htmlFor="group-meeting-name">
            Meeting name <span className="text-subtle font-normal">(optional)</span>
          </label>
          <input
            id="group-meeting-name"
            type="text"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Monthly Performance Review"
            className="border-default bg-default text-emphasis mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-subtle mt-1 text-xs">
            If set, this becomes the meeting title and clients can&apos;t change it. Leave empty to let
            the booker name the meeting.
          </p>
        </div>
      )}

      {/* Exclude dates */}
      {selected.length > 0 && (
        <div className="mt-3">
          <label className="text-emphasis text-sm font-medium" htmlFor="group-exclude-from">
            Exclude dates <span className="text-subtle font-normal">(optional)</span>
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="group-exclude-from"
              type="date"
              value={excludeFrom}
              onChange={(e) => setExcludeFrom(e.target.value)}
              className="border-default bg-default text-emphasis rounded-md border px-3 py-2 text-sm"
            />
            <span className="text-subtle text-sm">to</span>
            <input
              type="date"
              aria-label="Exclude until (optional)"
              value={excludeTo}
              onChange={(e) => setExcludeTo(e.target.value)}
              className="border-default bg-default text-emphasis rounded-md border px-3 py-2 text-sm"
            />
            <Button color="secondary" disabled={!excludeFrom} onClick={addExcludedRange}>
              Add
            </Button>
          </div>
          {excludedRanges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {excludedRanges.map((range) => (
                <span
                  key={`${range.from}_${range.to}`}
                  className="border-default bg-muted text-emphasis inline-flex items-center gap-1 rounded-md border py-1 pl-3 pr-1 text-sm">
                  {formatRange(range)}
                  <button
                    type="button"
                    aria-label={`Remove excluded dates ${formatRange(range)}`}
                    className="text-subtle hover:text-emphasis px-1.5"
                    onClick={() =>
                      setExcludedRanges((prev) =>
                        prev.filter((r) => !(r.from === range.from && r.to === range.to))
                      )
                    }>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-subtle mt-1 text-xs">
            No slots are offered on excluded days — here and on the link you send. Pick a single date, or
            a from–to range to block a whole week.
          </p>
        </div>
      )}

      {/* Combined availability */}
      {selected.length > 0 && (
        <div className="border-subtle mt-4 overflow-hidden rounded-lg border">
          <div className="border-subtle bg-muted flex items-center justify-between border-b px-4 py-2">
            <p className="text-emphasis text-sm font-medium">
              When everyone&apos;s free{" "}
              <span className="text-subtle">(next 2 weeks · {duration} min)</span>
            </p>
            <span className="text-subtle text-xs">{timeZone}</span>
          </div>

          {schedule.isPending ? (
            <div className="text-subtle p-4 text-sm">Finding times everyone is free…</div>
          ) : schedule.isError ? (
            <div className="text-subtle p-4 text-sm">
              Couldn&apos;t load availability. Please try again.
            </div>
          ) : days.length === 0 ? (
            <div className="text-subtle p-4 text-sm">
              No times where everyone is free in the next 2 weeks. Make sure each person has signed in and
              set their <strong>Availability</strong>.
            </div>
          ) : (
            <div className="max-h-96 divide-subtle divide-y overflow-y-auto">
              {days.map((day) => (
                <div key={day.date} className="px-4 py-3">
                  <p className="text-emphasis mb-2 text-xs font-medium uppercase tracking-wide">
                    {dayjs(day.date).format("dddd, MMM D")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {day.times.map((slot) => (
                      <a
                        key={slot.time}
                        href={bookHref(slot.time)}
                        target="_blank"
                        rel="noreferrer"
                        className="border-default bg-default text-emphasis hover:border-emphasis hover:bg-emphasis rounded-md border px-3 py-1.5 text-sm transition-colors">
                        {dayjs(slot.time).tz(timeZone).format("h:mm A")}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shareable link for clients */}
      {link && (
        <div className="border-subtle mt-6 rounded-lg border p-4">
          <p className="text-emphasis text-sm font-medium">Or send a link to a client</p>
          <p className="text-subtle mt-1 text-xs">
            Clients opening this link can only book <strong>{duration}-minute</strong> slots.{" "}
            {includeToday
              ? "Today's slots are included."
              : "Same-day slots are hidden — the earliest they can book is tomorrow."}{" "}
            {excludedRanges.length > 0 &&
              `Excluded: ${excludedRanges.map(formatRange).join(", ")}.`}
          </p>
          <p className="text-default mt-2 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {link}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                navigator.clipboard.writeText(link);
                showToast("Group link copied", "success");
              }}>
              {t("copy_link")}
            </Button>
            <Button color="secondary" href={link} target="_blank">
              {t("preview")}
            </Button>
          </div>

          {/* Save the current setup as a reusable template */}
          <div className="border-subtle mt-4 border-t pt-3">
            <label className="text-emphasis text-sm font-medium" htmlFor="group-template-name">
              Save this setup as a template
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="group-template-name"
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                maxLength={100}
                placeholder='e.g. "Monthly Performance (with Sai)"'
                className="border-default bg-default text-emphasis block w-full rounded-md border px-3 py-2 text-sm"
              />
              <Button
                color="secondary"
                disabled={!templateName.trim() || saveTemplate.isPending}
                onClick={() =>
                  saveTemplate.mutate({
                    name: templateName.trim(),
                    usernames: selected,
                    duration,
                    includeToday,
                    ...(meetingTitle.trim() ? { title: meetingTitle.trim() } : {}),
                  })
                }>
                Save
              </Button>
            </div>
            <p className="text-subtle mt-1 text-xs">
              Saves the people, duration, and meeting name. Saving with an existing template&apos;s name
              updates it.
            </p>
          </div>
        </div>
      )}

      <p className="text-subtle mt-4 text-xs">
        Everyone in the link must have set their <strong>Availability</strong>, otherwise no times will
        show. The meeting is collective (everyone attends) and gets a Google Meet link.
      </p>
    </div>
  );
}
