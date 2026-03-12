import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { EventInput, EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import type { EventRecord } from "@/lib/eventModel";

const FullCalendar = dynamic(() => import("@fullcalendar/react"), {
  ssr: false,
});

const toEventInput = (event: EventRecord): EventInput => ({
  id: event.id,
  title: event.title,
  start: event.start_datetime,
  end: event.end_datetime ?? undefined,
  url: event.source_url,
  extendedProps: event,
});

const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "ul",
  "ol",
  "li",
  "a",
]);

const stripTags = (value: string): string =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeHtml = (value: string): string => {
  if (typeof window === "undefined" || !("DOMParser" in window)) {
    return stripTags(value);
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  const elements = Array.from(doc.body.querySelectorAll("*"));

  elements.forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "div") {
      const replacement = doc.createElement("p");
      replacement.innerHTML = element.innerHTML;
      element.replaceWith(replacement);
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const text = doc.createTextNode(element.textContent ?? "");
      element.replaceWith(text);
      return;
    }

    Array.from(element.attributes).forEach((attr) => {
      if (tag === "a" && attr.name === "href") return;
      element.removeAttribute(attr.name);
    });

    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!href.startsWith("http")) {
        element.removeAttribute("href");
      } else {
        element.setAttribute("rel", "noreferrer");
        element.setAttribute("target", "_blank");
      }
    }
  });

  return doc.body.innerHTML.trim();
};

const buildIcsDownload = (
  event: EventRecord,
): { href: string; filename: string } => {
  const start = DateTime.fromISO(event.start_datetime).toUTC();
  const end = event.end_datetime
    ? DateTime.fromISO(event.end_datetime).toUTC()
    : start.plus({ hours: 1 });
  const stamp = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const format = "yyyyMMdd'T'HHmmss'Z'";
  const escapeValue = (value: string) =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ATLTechEvents//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@atltechevents`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start.toFormat(format)}`,
    `DTEND:${end.toFormat(format)}`,
    `SUMMARY:${escapeValue(event.title)}`,
  ];
  if (event.location_name) {
    lines.push(`LOCATION:${escapeValue(event.location_name)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeValue(stripTags(event.description))}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  const content = lines.join("\r\n");
  const href = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
  const filename = `${
    event.title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "event"
  }.ics`;
  return { href, filename };
};

type Props = {
  events: EventRecord[];
};

const ORGANIZER_URLS: Record<string, string> = {
  "Tech Square ATL": "https://www.techsquareatl.com/events",
  ATDC: "https://portal.atdc.org/s/events",
  "Atlanta Tech Village": "https://www.atlantatechvillage.com/events/upcoming",
};

const getOrganizerPillClass = (organizer: string): string => {
  switch (organizer) {
    case "Tech Square ATL":
      return "pill-tech-square";
    case "ATDC":
      return "pill-atdc";
    case "Atlanta Tech Village":
      return "pill-atv";
    default:
      return "pill-tech-square";
  }
};

export default function CalendarView({ events }: Props) {
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const calendarEvents = useMemo(() => events.map(toEventInput), [events]);

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    setSelected(arg.event.extendedProps as EventRecord);
  };

  return (
    <div className="rounded-2xl border border-border-subtle bg-card-bg p-4 shadow-sm">
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,listMonth",
        }}
        events={calendarEvents}
        eventClick={handleEventClick}
        eventDidMount={(info) => {
          info.el.setAttribute("title", info.event.title);
        }}
        height="auto"
      />

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 p-4">
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card-bg shadow-lg max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-text-primary">
                  {selected.title}
                </h3>
                {selected.location_name && (
                  <p className="text-sm text-text-secondary">
                    {selected.location_name}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <a
                  className={`org-pill ${getOrganizerPillClass(
                    selected.organizer,
                  )} hover:opacity-90`}
                  href={
                    ORGANIZER_URLS[selected.organizer] ?? selected.source_url
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.organizer}
                </a>
                <button
                  className="rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-bg-secondary"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {selected.description && (
                <div
                  className="event-description mt-3 max-w-[70ch] text-sm text-text-primary"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(selected.description),
                  }}
                />
              )}
              <div className="mt-4 flex items-center justify-between gap-3">
                <a
                  className="text-sm font-semibold text-accent hover:underline"
                  href={selected.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View details
                </a>
                <a
                  className="text-sm font-semibold text-accent hover:underline"
                  href={buildIcsDownload(selected).href}
                  download={buildIcsDownload(selected).filename}
                >
                  Add to calendar
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
