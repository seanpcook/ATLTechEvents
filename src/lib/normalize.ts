import crypto from "crypto";
import { DateTime } from "luxon";
import type { EventRecord, Organizer, ScrapedEvent } from "@/lib/eventModel";

const TIMEZONE = "America/New_York" as const;

const normalizeDateTime = (value: string, isAllDay: boolean): string => {
  const dt = DateTime.fromISO(value, { zone: TIMEZONE });
  if (dt.isValid) {
    if (isAllDay) {
      return dt.startOf("day").toISO() ?? value;
    }
    return dt.toISO() ?? value;
  }
  return value;
};

const hashId = (
  organizer: Organizer,
  sourceEventId: string | null,
  sourceUrl: string,
): string => {
  const base = `${organizer}:${sourceEventId ?? sourceUrl}`;
  return crypto.createHash("sha256").update(base).digest("hex");
};

export const normalizeEvent = (event: ScrapedEvent): EventRecord => {
  const isAllDay =
    event.end_datetime === null && !event.start_datetime.includes("T");
  const start = normalizeDateTime(event.start_datetime, isAllDay);
  const end = event.end_datetime
    ? normalizeDateTime(event.end_datetime, isAllDay)
    : null;

  return {
    id:
      event.id ??
      hashId(event.organizer, event.source_event_id, event.source_url),
    title: event.title.trim(),
    description: event.description.trim(),
    start_datetime: start,
    end_datetime: end,
    timezone: TIMEZONE,
    location_name: event.location_name ?? null,
    location_address: event.location_address ?? null,
    organizer: event.organizer,
    source_url: event.source_url,
    source_event_id: event.source_event_id ?? null,
    last_seen_at:
      event.last_seen_at ??
      DateTime.now().setZone(TIMEZONE).toISO() ??
      new Date().toISOString(),
  };
};
