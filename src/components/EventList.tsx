import { useState } from "react";
import { DateTime } from "luxon";
import type { EventRecord } from "@/lib/eventModel";

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

export default function EventList({ events }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (events.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border-subtle bg-card-bg p-6 text-sm text-text-secondary">
        No upcoming events found.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => {
        const start = DateTime.fromISO(event.start_datetime).toLocaleString(
          DateTime.DATETIME_MED,
        );
        const sanitizedDescription = event.description
          ? sanitizeHtml(event.description)
          : "";
        const previewText = sanitizedDescription
          ? stripTags(sanitizedDescription)
          : "";
        const isLong = previewText.length > 280;
        const isExpanded = expanded[event.id] ?? false;
        return (
          <div
            key={event.id}
            className="rounded-2xl border border-border-subtle bg-card-bg p-5 shadow-sm"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-text-primary">
                  {event.title}
                </h3>
                <a
                  className={`org-pill ${getOrganizerPillClass(
                    event.organizer,
                  )} hover:opacity-90`}
                  href={ORGANIZER_URLS[event.organizer] ?? event.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.organizer}
                </a>
              </div>
              <p className="text-sm font-medium text-text-secondary">{start}</p>
              {event.location_name && (
                <p className="text-sm text-text-secondary">
                  {event.location_name}
                </p>
              )}
            </div>
            {sanitizedDescription && (
              <div className="event-description mt-3 max-w-[70ch] text-sm text-text-primary">
                {isExpanded ? (
                  <div
                    className="space-y-2"
                    dangerouslySetInnerHTML={{
                      __html: sanitizedDescription,
                    }}
                  />
                ) : (
                  <p className="line-clamp-3">{previewText}</p>
                )}
                {isLong && (
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-accent hover:underline"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [event.id]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            )}
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <a
                  className="text-sm font-semibold text-accent hover:underline"
                  href={event.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View details
                </a>
                <a
                  className="text-sm font-semibold text-accent hover:underline"
                  href={buildIcsDownload(event).href}
                  download={buildIcsDownload(event).filename}
                >
                  Add to calendar
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
