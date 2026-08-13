import { useMemo } from "react";

import { useIsPlatform } from "@calcom/atoms/hooks/useIsPlatform";
import dayjs from "@calcom/dayjs";
import { useIsEmbed } from "@calcom/embed-core/embed-iframe";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useInitializeWeekStart } from "@calcom/features/bookings/hooks/useInitializeWeekStart";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { formatDateTime } from "@calcom/lib/dateTimeFormatter";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { BookerLayouts } from "@calcom/prisma/zod-utils";
import { Button } from "@calcom/ui/components/button";
import { ButtonGroup } from "@calcom/ui/components/buttonGroup";
import { Tooltip } from "@calcom/ui/components/tooltip";

import { TimeFormatToggle } from "@calcom/features/bookings/components/TimeFormatToggle";

export function Header({
  extraDays,
  isMobile,
  enabledLayouts,
  nextSlots,
  eventSlug,
  isMyLink,
  renderOverlay,
  isCalendarView,
}: {
  extraDays: number;
  isMobile: boolean;
  enabledLayouts: BookerLayouts[];
  nextSlots: number;
  eventSlug: string;
  isMyLink: boolean;
  renderOverlay?: () => JSX.Element | null;
  isCalendarView?: boolean;
}) {
  const { t, i18n } = useLocale();
  const isEmbed = useIsEmbed();
  const isPlatform = useIsPlatform();
  const layout = useBookerStoreContext((state) => state.layout);
  const selectedDateString = useBookerStoreContext((state) => state.selectedDate);
  const setSelectedDate = useBookerStoreContext((state) => state.setSelectedDate);
  const addToSelectedDate = useBookerStoreContext((state) => state.addToSelectedDate);
  const isMonthView = isCalendarView !== undefined ? !isCalendarView : layout === BookerLayouts.MONTH_VIEW;
  const today = dayjs();
  const selectedDate = selectedDateString ? dayjs(selectedDateString) : today;
  const selectedDateMin3DaysDifference = useMemo(() => {
    const diff = today.diff(selectedDate, "days");
    return diff > 3 || diff < -3;
  }, [today, selectedDate]);

  useInitializeWeekStart(isPlatform, isCalendarView ?? false);

  if (isMobile || !enabledLayouts) return null;

  // The layout switcher (month/week/column icons) is intentionally not
  // rendered: bookers always get the layout the link opened with.
  if (isMonthView) {
    return (
      <div className="flex gap-2">
        {isMyLink && !isEmbed ? (
          <Tooltip content={t("troubleshooter_tooltip")} side="bottom">
            <Button
              color="primary"
              target="_blank"
              href={`${WEBAPP_URL}/availability/troubleshoot?eventType=${eventSlug}`}>
              {t("need_help")}
            </Button>
          </Tooltip>
        ) : (
          renderOverlay?.()
        )}
      </div>
    );
  }
  const endDate = selectedDate.add(layout === BookerLayouts.COLUMN_VIEW ? extraDays : extraDays - 1, "days");

  const isSameMonth = () => {
    return selectedDate.format("MMM") === endDate.format("MMM");
  };

  const isSameYear = () => {
    return selectedDate.format("YYYY") === endDate.format("YYYY");
  };
  const formatMonthLabel = (date: Date) =>
    formatDateTime(date, { locale: i18n.language ?? "en", month: "short" });
  const FormattedSelectedDateRange = () => {
    return (
      <h3 className="min-w-[150px] text-base font-semibold leading-4">
        {formatMonthLabel(selectedDate.toDate())} {selectedDate.format("D")}
        {!isSameYear() && <span className="text-subtle">, {selectedDate.format("YYYY")} </span>}-{" "}
        {!isSameMonth() && formatMonthLabel(endDate.toDate())} {endDate.format("D")},{" "}
        <span className="text-subtle">
          {isSameYear() ? selectedDate.format("YYYY") : endDate.format("YYYY")}
        </span>
      </h3>
    );
  };

  return (
    <div className="border-default relative z-10 flex border-b px-5 py-4 ltr:border-l rtl:border-r">
      <div className="flex items-center gap-5 rtl:grow">
        <FormattedSelectedDateRange />
        <ButtonGroup>
          <Button
            className="group rtl:ml-1 rtl:rotate-180"
            variant="icon"
            color="minimal"
            StartIcon="chevron-left"
            aria-label="Previous Day"
            onClick={() => addToSelectedDate(layout === BookerLayouts.COLUMN_VIEW ? -nextSlots : -extraDays)}
          />
          <Button
            className="group rtl:mr-1 rtl:rotate-180"
            variant="icon"
            color="minimal"
            StartIcon="chevron-right"
            aria-label="Next Day"
            onClick={() => addToSelectedDate(layout === BookerLayouts.COLUMN_VIEW ? nextSlots : extraDays)}
          />
          {selectedDateMin3DaysDifference && (
            <Button
              className="capitalize ltr:ml-2 rtl:mr-2"
              color="secondary"
              onClick={() => {
                const selectedDate = (isCalendarView ? today.startOf("week") : today).format("YYYY-MM-DD");
                setSelectedDate({ date: selectedDate });
              }}>
              {t("today")}
            </Button>
          )}
        </ButtonGroup>
      </div>
      <div className="ml-auto flex gap-2">
        {renderOverlay?.()}
        <TimeFormatToggle />
      </div>
    </div>
  );
}
