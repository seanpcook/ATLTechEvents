import { DateTime } from "luxon";
import type { ScrapedEvent } from "@/lib/eventModel";

type JsonLd = {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?:
    | {
        name?: string;
        address?:
          | {
              streetAddress?: string;
              addressLocality?: string;
              addressRegion?: string;
              postalCode?: string;
              addressCountry?: string;
            }
          | string;
      }
    | string;
  url?: string;
};

const toArray = (value: unknown): JsonLd[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value as JsonLd[];
  return [value as JsonLd];
};

const isEvent = (entry: JsonLd): boolean => {
  const type = entry["@type"];
  if (!type) return false;
  if (Array.isArray(type)) {
    return type.includes("Event");
  }
  return type === "Event";
};

const formatAddress = (
  location: JsonLd["location"],
): { name: string | null; address: string | null } => {
  if (!location || typeof location === "string") {
    return { name: location ?? null, address: null };
  }
  const locName = location.name ?? null;
  if (!location.address || typeof location.address === "string") {
    return { name: locName, address: location.address ?? null };
  }
  const addr = [
    location.address.streetAddress,
    location.address.addressLocality,
    location.address.addressRegion,
    location.address.postalCode,
    location.address.addressCountry,
  ]
    .filter(Boolean)
    .join(", ");
  return { name: locName, address: addr || null };
};

export const parseJsonLdEvents = (
  json: unknown,
  organizer: ScrapedEvent["organizer"],
): ScrapedEvent[] => {
  const entries = toArray(json);
  const events: ScrapedEvent[] = [];

  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const payload = entry as JsonLd;
    if (!isEvent(payload)) return;

    const start = payload.startDate ?? "";
    if (!start) return;

    const end = payload.endDate ?? null;
    const location = formatAddress(payload.location);

    events.push({
      title: payload.name ?? "Untitled event",
      description: payload.description ?? "",
      start_datetime: DateTime.fromISO(start).toISO() ?? start,
      end_datetime: end ? (DateTime.fromISO(end).toISO() ?? end) : null,
      timezone: "America/New_York",
      location_name: location.name,
      location_address: location.address,
      organizer,
      source_url: payload.url ?? "",
      source_event_id: null,
    });
  });

  return events;
};
