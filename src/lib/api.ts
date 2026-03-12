import type { EventRecord, Organizer } from "@/lib/eventModel";

export type DateRange = "today" | "week" | "month" | "all";

export const buildEventsUrl = (
  range: DateRange,
  organizer: Organizer | "all",
): string => {
  const params = new URLSearchParams();
  const now = new Date();

  if (range !== "all") {
    const start = new Date(now);
    params.set("start_date", start.toISOString());
    const end = new Date(now);
    if (range === "today") {
      end.setDate(now.getDate() + 1);
    } else if (range === "week") {
      end.setDate(now.getDate() + 7);
    } else if (range === "month") {
      end.setMonth(now.getMonth() + 1);
    }
    params.set("end_date", end.toISOString());
  }

  if (organizer !== "all") {
    params.set("organizer", organizer);
  }

  if (range === "all") {
    params.set("limit", "500");
  }

  const query = params.toString();
  return query ? `/api/events?${query}` : "/api/events";
};

export const fetchEvents = async (
  range: DateRange,
  organizer: Organizer | "all",
): Promise<EventRecord[]> => {
  const url = buildEventsUrl(range, organizer);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load events");
  }
  const payload = (await response.json()) as { events: EventRecord[] };
  return payload.events;
};
