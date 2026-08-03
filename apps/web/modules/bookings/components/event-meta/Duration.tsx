import type { TFunction } from "i18next";
import { useEffect } from "react";

import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

/** Render X mins as X hours or X hours Y mins instead of in minutes once >= 60 minutes */
export const getDurationFormatted = (mins: number | undefined, t: TFunction) => {
  if (!mins) return null;

  const hours = Math.floor(mins / 60);
  mins %= 60;
  // format minutes string
  let minStr = "";
  if (mins > 0) {
    minStr =
      mins === 1
        ? t("minute_one_short", { count: 1 })
        : t("multiple_duration_timeUnit_short", { count: mins, unit: "minute" });
  }
  // format hours string
  let hourStr = "";
  if (hours > 0) {
    hourStr =
      hours === 1
        ? t("hour_one_short", { count: 1 })
        : t("multiple_duration_timeUnit_short", { count: hours, unit: "hour" });
  }

  if (hourStr && minStr) return `${hourStr} ${minStr}`;
  return hourStr || minStr;
};

export const EventDuration = ({
  event,
}: {
  event: Pick<BookerEvent, "length" | "metadata" | "isDynamic">;
}) => {
  const { t } = useLocale();
  const searchParams = useCompatSearchParams();
  // Links shared from the internal group-link page carry lockDuration=1 so
  // clients can only book the meeting length the organizer allocated. We can't
  // key off the `duration` param alone because the booker store writes it back
  // into the URL on every selection.
  const isDurationLockedByLink = searchParams?.get("lockDuration") === "1";
  const [selectedDuration, setSelectedDuration, state] = useBookerStoreContext((state) => [
    state.selectedDuration,
    state.setSelectedDuration,
    state.state,
  ]);

  const isDynamicEvent = "isDynamic" in event && event.isDynamic;
  // Sets initial value of selected duration to the default duration.
  useEffect(() => {
    // Only store event duration in url if event has multiple durations.
    if (!selectedDuration && (event.metadata?.multipleDuration || isDynamicEvent))
      setSelectedDuration(event.length);
  }, [selectedDuration, setSelectedDuration, event.metadata?.multipleDuration, event.length, isDynamicEvent]);

  if (!event?.metadata?.multipleDuration && !isDynamicEvent)
    return <>{getDurationFormatted(event.length, t)}</>;

  const durations = event?.metadata?.multipleDuration || [15, 30, 60, 90];
  const hideDurationSelector = event?.metadata?.hideDurationSelectorInBookingPage;

  // When duration selector is hidden, show only the selected/default duration as text
  // URL params can still set the duration, but the user cannot change it via UI
  if (hideDurationSelector || isDurationLockedByLink) {
    return <>{getDurationFormatted(selectedDuration || event.length, t)}</>;
  }

  return selectedDuration ? (
    <div className="border-default mr-5 rounded-md border">
      <ul className="bg-default flex max-w-full flex-wrap items-center gap-0.5 rounded-md p-1">
        {durations
          .filter((dur) => state !== "booking" || dur === selectedDuration)
          .map((duration, index) => (
            <li
              data-testId={`multiple-choice-${duration}mins`}
              data-active={selectedDuration === duration ? "true" : "false"}
              key={index}
              onClick={() => setSelectedDuration(duration)}
              className={classNames(
                selectedDuration === duration ? "bg-emphasis" : "hover:text-emphasis",
                "text-default cursor-pointer rounded-[4px] px-3 py-1.5 text-sm leading-tight transition"
              )}>
              <div className="w-max">{getDurationFormatted(duration, t)}</div>
            </li>
          ))}
      </ul>
    </div>
  ) : null;
};
