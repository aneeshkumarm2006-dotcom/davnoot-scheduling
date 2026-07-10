"use client";

import { useMemo, useState } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { showToast } from "@calcom/ui/components/toast";

/**
 * Builds a dynamic group booking link (`/alice+bob+carol`).
 *
 * Dynamic booking already intersects every listed person's calendar and availability —
 * the booker only sees slots where everyone is free — but the capability was undiscoverable
 * because you had to hand-type the URL. This surfaces it as a first-class feature.
 */
export default function GroupLinkView() {
  const { t } = useLocale();
  const { data, isPending } = trpc.viewer.teams.listBookableUsers.useQuery();
  const [selected, setSelected] = useState<string[]>([]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const meUsername = data?.me?.username ?? null;

  const link = useMemo(() => {
    if (!meUsername || selected.length === 0) return null;
    return `${origin}/${[meUsername, ...selected].join("+")}`;
  }, [origin, meUsername, selected]);

  const toggle = (username: string) =>
    setSelected((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );

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
        Pick who should be in the meeting. The link only offers times when{" "}
        <strong>everyone is free</strong> — all calendars are checked automatically.
      </p>

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

      {/* Generated link */}
      <div className="border-subtle mt-6 rounded-lg border p-4">
        <p className="text-emphasis text-sm font-medium">Your group link</p>
        {link ? (
          <>
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
          </>
        ) : (
          <p className="text-subtle mt-2 text-sm">Select at least one person to generate a link.</p>
        )}
      </div>

      <p className="text-subtle mt-4 text-xs">
        Tip: everyone in the link must have set their <strong>Availability</strong> — otherwise no times
        will show. The meeting is collective (everyone attends) and gets a Google Meet link.
      </p>
    </div>
  );
}
