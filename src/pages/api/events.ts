import type { NextApiRequest, NextApiResponse } from "next";
import { DateTime } from "luxon";
import prisma from "@/lib/db";

const organizerMap: Record<
  string,
  "TECH_SQUARE_ATL" | "ATLANTA_TECH_VILLAGE" | "ATDC"
> = {
  "Tech Square ATL": "TECH_SQUARE_ATL",
  "Atlanta Tech Village": "ATLANTA_TECH_VILLAGE",
  ATDC: "ATDC",
  TECH_SQUARE_ATL: "TECH_SQUARE_ATL",
  ATLANTA_TECH_VILLAGE: "ATLANTA_TECH_VILLAGE",
};

const parseDate = (value?: string | string[]): Date | undefined => {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const dt = DateTime.fromISO(raw, { zone: "America/New_York" });
  if (!dt.isValid) return undefined;
  return dt.toJSDate();
};

const normalizeTitle = (value: string): string => {
  const lower = value.toLowerCase();
  const feedbackRegex = /feedback\s+friday(s)?/i;
  if (feedbackRegex.test(lower)) return "feedbackfriday";
  const mondayCoffeeRegex = /mon(dai|day)\s+coffee/i;
  if (mondayCoffeeRegex.test(lower)) return "mondaycoffee";

  const tokens = lower
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.length > 3 && token.endsWith("s")) {
        return token.slice(0, -1);
      }
      return token;
    })
    .filter((token) => !["hybrid", "virtual", "inperson"].includes(token));
  return tokens.join("");
};

const buildDedupeKey = (event: {
  title: string;
  startDatetime: Date;
}): string => {
  const start = DateTime.fromJSDate(event.startDatetime, {
    zone: "America/New_York",
  }).toFormat("yyyy-LL-dd HH:mm");
  return `${normalizeTitle(event.title)}:${start}`;
};

const pickPreferred = <
  T extends { organizer: "TECH_SQUARE_ATL" | "ATLANTA_TECH_VILLAGE" | "ATDC" },
>(
  current: T,
  incoming: T,
): T => {
  if (current.organizer === "ATDC") return current;
  if (incoming.organizer === "ATDC") return incoming;
  return current;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const startDate =
    parseDate(req.query.start_date) ?? DateTime.now().toJSDate();
  const endDate = parseDate(req.query.end_date);
  const organizerParam = req.query.organizer;
  const limitParam = req.query.limit;

  const organizerKey = Array.isArray(organizerParam)
    ? organizerParam[0]
    : organizerParam;
  const organizer = organizerKey ? organizerMap[organizerKey] : undefined;

  const limitValueRaw = Array.isArray(limitParam) ? limitParam[0] : limitParam;
  const limit = limitValueRaw ? Number(limitValueRaw) : 500;

  const events = await prisma.event.findMany({
    where: {
      startDatetime: {
        gte: startDate,
        ...(endDate ? { lte: endDate } : {}),
      },
      ...(organizer ? { organizer } : {}),
    },
    orderBy: { startDatetime: "asc" },
    take: Number.isNaN(limit) ? 500 : Math.min(limit, 500),
  });

  const typedEvents = events as Array<{
    id: string;
    title: string;
    description: string;
    startDatetime: Date;
    endDatetime: Date | null;
    timezone: string;
    locationName: string | null;
    locationAddress: string | null;
    organizer: "TECH_SQUARE_ATL" | "ATLANTA_TECH_VILLAGE" | "ATDC";
    sourceUrl: string;
    sourceEventId: string | null;
    lastSeenAt: Date;
  }>;

  const dedupedEvents = organizer
    ? typedEvents
    : Array.from(
        typedEvents
          .reduce((acc, event) => {
            const key = buildDedupeKey(event);
            const existing = acc.get(key);
            if (!existing) {
              acc.set(key, event);
              return acc;
            }
            acc.set(key, pickPreferred(existing, event));
            return acc;
          }, new Map<string, (typeof typedEvents)[number]>())
          .values(),
      );

  res.status(200).json({
    events: dedupedEvents.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      start_datetime: event.startDatetime.toISOString(),
      end_datetime: event.endDatetime ? event.endDatetime.toISOString() : null,
      timezone: event.timezone,
      location_name: event.locationName,
      location_address: event.locationAddress,
      organizer:
        event.organizer === "TECH_SQUARE_ATL"
          ? "Tech Square ATL"
          : event.organizer === "ATLANTA_TECH_VILLAGE"
            ? "Atlanta Tech Village"
            : "ATDC",
      source_url: event.sourceUrl,
      source_event_id: event.sourceEventId,
      last_seen_at: event.lastSeenAt.toISOString(),
    })),
  });
}
