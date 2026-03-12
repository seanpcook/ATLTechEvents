import type { DateRange } from "@/lib/api";
import type { Organizer } from "@/lib/eventModel";

type Props = {
  organizer: Organizer | "all";
  range: DateRange;
  onOrganizerChange: (value: Organizer | "all") => void;
  onRangeChange: (value: DateRange) => void;
};

export default function Filters({
  organizer,
  range,
  onOrganizerChange,
  onRangeChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-bg-secondary/70 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm font-medium text-text-secondary">
          Organization
          <select
            className="mt-2 block w-full rounded-xl border border-border-subtle bg-card-bg px-3 py-2 text-sm text-text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            value={organizer}
            onChange={(event) =>
              onOrganizerChange(event.target.value as Organizer | "all")
            }
          >
            <option value="all">All</option>
            <option value="Tech Square ATL">Tech Square ATL</option>
            <option value="Atlanta Tech Village">Atlanta Tech Village</option>
            <option value="ATDC">ATDC</option>
          </select>
        </label>
        <label className="flex-1 text-sm font-medium text-text-secondary">
          Date range
          <select
            className="mt-2 block w-full rounded-xl border border-border-subtle bg-card-bg px-3 py-2 text-sm text-text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            value={range}
            onChange={(event) => onRangeChange(event.target.value as DateRange)}
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Upcoming</option>
          </select>
        </label>
      </div>
    </div>
  );
}
