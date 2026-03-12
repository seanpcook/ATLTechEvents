import axios from "axios";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";
import type { ScrapedEvent } from "@/lib/eventModel";
import { parseJsonLdEvents } from "@/lib/sources/jsonLd";

const SOURCE_URL = "https://www.techsquareatl.com/events";
const ELFSIGHT_WIDGET_ID = "e51101e7-bc8a-4a98-a820-f3fb1f79987b";
const ELFSIGHT_BOOT_URL = `https://core.service.elfsight.com/p/boot/?page=${encodeURIComponent(
  SOURCE_URL,
)}&w=${ELFSIGHT_WIDGET_ID}`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TECHSQUARE_RECURRENCE_LOOKAHEAD_DAYS = Number(
  process.env.TECHSQUARE_RECURRENCE_LOOKAHEAD_DAYS ?? "180",
);
const TECHSQUARE_RECURRENCE_MAX_OCCURRENCES = Number(
  process.env.TECHSQUARE_RECURRENCE_MAX_OCCURRENCES ?? "200",
);

const tryRenderWithPlaywright = async (): Promise<string | null> => {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(SOURCE_URL, { waitUntil: "networkidle" });
    const html = await page.content();
    await browser.close();
    return html;
  } catch {
    return null;
  }
};

const parseDate = (
  dateText: string,
  timeText?: string | null,
): { start: string; end: string | null } | null => {
  if (!dateText) return null;
  const combined = timeText ? `${dateText} ${timeText}` : dateText;
  const dt = DateTime.fromFormat(combined, "MMMM d, yyyy h:mm a", {
    zone: "America/New_York",
  });
  if (dt.isValid) {
    return { start: dt.toISO() ?? combined, end: null };
  }
  const dtDateOnly = DateTime.fromFormat(dateText, "MMMM d, yyyy", {
    zone: "America/New_York",
  });
  if (dtDateOnly.isValid) {
    return { start: dtDateOnly.toISODate() ?? dateText, end: null };
  }
  return null;
};

type ElfsightEventDateTime = {
  date?: string;
  time?: string;
};

type ElfsightEvent = {
  id?: string;
  name?: string;
  description?: string;
  start?: ElfsightEventDateTime;
  end?: ElfsightEventDateTime;
  timeZone?: string;
  location?: { id?: string } | string[];
  host?: { id?: string } | string[];
  buttonLink?: { value?: string };
  repeatPeriod?: string;
  repeatFrequency?: string;
  repeatInterval?: number;
  repeatEnds?: string;
  repeatEndsDate?: ElfsightEventDateTime | null;
  repeatEndsOccurrences?: number;
  repeatWeeklyOnDays?: string[];
  exceptions?: ElfsightEventDateTime[];
};

type ElfsightLocation = {
  id?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

type ElfsightHost = {
  id?: string;
  name?: string;
};

const formatElfsightAddress = (
  location?: ElfsightLocation | null,
): string | null => {
  if (!location) return null;
  const parts = [
    location.address,
    location.city,
    location.state,
    location.zip,
    location.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
};

const parseElfsightDateTime = (
  payload?: ElfsightEventDateTime,
  zone?: string | null,
): string | null => {
  if (!payload?.date) return null;
  const datePart = payload.date;
  const timePart = payload.time?.trim();
  const iso = timePart ? `${datePart}T${timePart}` : datePart;
  const dt = DateTime.fromISO(iso, { zone: zone || "America/New_York" });
  if (!dt.isValid) return payload.date;
  return timePart ? (dt.toISO() ?? iso) : (dt.toISODate() ?? datePart);
};

const parseElfsightDateTimeValue = (
  payload?: ElfsightEventDateTime,
  zone?: string | null,
): { dt: DateTime; hasTime: boolean } | null => {
  if (!payload?.date) return null;
  const hasTime = Boolean(payload.time?.trim());
  const iso = hasTime ? `${payload.date}T${payload.time}` : payload.date;
  const dt = DateTime.fromISO(iso, { zone: zone || "America/New_York" });
  if (!dt.isValid) return null;
  return { dt, hasTime };
};

const formatOccurrenceDateTime = (dt: DateTime, hasTime: boolean): string => {
  if (hasTime) return dt.toISO() ?? dt.toISODate() ?? dt.toString();
  return dt.toISODate() ?? dt.toISO() ?? dt.toString();
};

const WEEKDAY_MAP: Record<string, number> = {
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
  su: 7,
};

const normalizeWeekdays = (
  days: string[] | undefined,
  fallback: number,
): number[] => {
  const mapped = (days ?? [])
    .map((day) => WEEKDAY_MAP[day.toLowerCase()])
    .filter(Boolean) as number[];
  if (mapped.length === 0) return [fallback];
  return Array.from(new Set(mapped)).sort((a, b) => a - b);
};

const buildRecurringOccurrences = (
  event: ElfsightEvent,
  startInfo: { dt: DateTime; hasTime: boolean },
  timezone: string,
): DateTime[] => {
  const rawRepeatPeriod = event.repeatPeriod ?? "";
  const repeatFrequency = event.repeatFrequency ?? "";
  const repeatPeriod = (() => {
    if (!rawRepeatPeriod || rawRepeatPeriod === "noRepeat") return "";
    if (rawRepeatPeriod === "custom") {
      if (repeatFrequency === "weekly" && event.repeatWeeklyOnDays?.length) {
        return "weeklyOn";
      }
      return repeatFrequency;
    }
    return rawRepeatPeriod;
  })();
  if (!repeatPeriod) return [startInfo.dt];

  const interval = Math.max(1, event.repeatInterval ?? 1);
  const lookaheadDays = Number.isFinite(TECHSQUARE_RECURRENCE_LOOKAHEAD_DAYS)
    ? TECHSQUARE_RECURRENCE_LOOKAHEAD_DAYS
    : 180;
  const maxOccurrences = Number.isFinite(TECHSQUARE_RECURRENCE_MAX_OCCURRENCES)
    ? TECHSQUARE_RECURRENCE_MAX_OCCURRENCES
    : 200;
  const now = DateTime.now().setZone(timezone);
  const startThreshold = now.startOf("day");
  const repeatEndsDate = parseElfsightDateTimeValue(
    event.repeatEndsDate ?? undefined,
    timezone,
  )?.dt;
  const endBoundary = (() => {
    if (event.repeatEnds === "onDate" && repeatEndsDate?.isValid) {
      if (repeatEndsDate < startInfo.dt) {
        return now.plus({ days: lookaheadDays });
      }
      return repeatEndsDate;
    }
    return now.plus({ days: lookaheadDays });
  })();

  const exceptionSet = new Set(
    (event.exceptions ?? [])
      .map((exception) =>
        parseElfsightDateTimeValue(exception, timezone)?.dt.toISO(),
      )
      .filter(Boolean),
  );
  const exceptionDateSet = new Set(
    (event.exceptions ?? [])
      .map((exception) => exception?.date)
      .filter(Boolean),
  );

  const occurrences: DateTime[] = [];
  const maxByOccurrences =
    event.repeatEnds === "afterOccurrences"
      ? Math.max(1, event.repeatEndsOccurrences ?? 0)
      : null;
  const pushOccurrence = (dt: DateTime) => {
    if (occurrences.length >= maxOccurrences) return false;
    if (maxByOccurrences && occurrences.length >= maxByOccurrences)
      return false;
    if (dt < startInfo.dt) return true;
    if (dt < startThreshold) return true;
    if (dt > endBoundary) return false;
    if (exceptionSet.has(dt.toISO())) return true;
    const occurrenceDate = dt.toISODate();
    if (occurrenceDate && exceptionDateSet.has(occurrenceDate)) return true;
    occurrences.push(dt);
    return true;
  };

  if (repeatPeriod === "weeklyOn") {
    let weekdays = normalizeWeekdays(
      event.repeatWeeklyOnDays,
      startInfo.dt.weekday,
    );
    if (
      event.repeatWeeklyOnDays?.length &&
      !weekdays.includes(startInfo.dt.weekday)
    ) {
      weekdays = [startInfo.dt.weekday];
    }
    const timeParts = {
      hour: startInfo.dt.hour,
      minute: startInfo.dt.minute,
      second: startInfo.dt.second,
      millisecond: startInfo.dt.millisecond,
    };
    const weekAnchor =
      startInfo.dt < startThreshold ? startThreshold : startInfo.dt;
    let weekCursor = weekAnchor.startOf("week");
    while (weekCursor <= endBoundary) {
      for (const weekday of weekdays) {
        const occurrence = weekCursor
          .plus({ days: weekday - 1 })
          .set(timeParts);
        const shouldContinue = pushOccurrence(occurrence);
        if (!shouldContinue) return occurrences;
      }
      weekCursor = weekCursor.plus({ weeks: interval });
    }
    return occurrences;
  }

  if (repeatPeriod === "nthDayInMonth") {
    const timeParts = {
      hour: startInfo.dt.hour,
      minute: startInfo.dt.minute,
      second: startInfo.dt.second,
      millisecond: startInfo.dt.millisecond,
    };
    const ordinal = Math.ceil(startInfo.dt.day / 7);
    const weekday = startInfo.dt.weekday;
    const monthAnchor =
      startInfo.dt < startThreshold ? startThreshold : startInfo.dt;
    let monthCursor = monthAnchor.startOf("month");
    while (monthCursor <= endBoundary) {
      const firstWeekday = monthCursor.weekday;
      const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
      const daysInMonth = monthCursor.daysInMonth ?? 31;
      if (day <= daysInMonth) {
        const occurrence = monthCursor.set({ day, ...timeParts });
        const shouldContinue = pushOccurrence(occurrence);
        if (!shouldContinue) return occurrences;
      }
      monthCursor = monthCursor.plus({ months: interval });
    }
    return occurrences;
  }

  let cursor = startInfo.dt;
  if (cursor < startThreshold) {
    switch (repeatPeriod) {
      case "daily": {
        const diffDays = Math.floor(startThreshold.diff(cursor, "days").days);
        const shift = Math.floor(diffDays / interval) * interval;
        cursor = cursor.plus({ days: shift });
        if (cursor < startThreshold) cursor = cursor.plus({ days: interval });
        break;
      }
      case "weekly": {
        const diffWeeks = Math.floor(
          startThreshold.diff(cursor, "weeks").weeks,
        );
        const shift = Math.floor(diffWeeks / interval) * interval;
        cursor = cursor.plus({ weeks: shift });
        if (cursor < startThreshold) cursor = cursor.plus({ weeks: interval });
        break;
      }
      case "monthly":
      case "monthlyOn": {
        const diffMonths = Math.floor(
          startThreshold.diff(cursor, "months").months,
        );
        const shift = Math.floor(diffMonths / interval) * interval;
        cursor = cursor.plus({ months: shift });
        if (cursor < startThreshold) cursor = cursor.plus({ months: interval });
        break;
      }
      case "yearly": {
        const diffYears = Math.floor(
          startThreshold.diff(cursor, "years").years,
        );
        const shift = Math.floor(diffYears / interval) * interval;
        cursor = cursor.plus({ years: shift });
        if (cursor < startThreshold) cursor = cursor.plus({ years: interval });
        break;
      }
      default:
        break;
    }
  }
  while (cursor <= endBoundary) {
    const shouldContinue = pushOccurrence(cursor);
    if (!shouldContinue) break;
    switch (repeatPeriod) {
      case "daily":
        cursor = cursor.plus({ days: interval });
        break;
      case "weekly":
        cursor = cursor.plus({ weeks: interval });
        break;
      case "monthly":
      case "monthlyOn":
        cursor = cursor.plus({ months: interval });
        break;
      case "yearly":
        cursor = cursor.plus({ years: interval });
        break;
      default:
        cursor = cursor.plus({ weeks: interval });
        break;
    }
  }

  return occurrences;
};

const extractElfsightEvents = (data: unknown): ScrapedEvent[] => {
  if (!data || typeof data !== "object") return [];
  const payload = data as {
    data?: {
      widgets?: Record<
        string,
        {
          data?: {
            settings?: {
              events?: ElfsightEvent[];
              locations?: ElfsightLocation[];
              hosts?: ElfsightHost[];
            };
          };
        }
      >;
    };
    widgets?: Record<
      string,
      {
        data?: {
          settings?: {
            events?: ElfsightEvent[];
            locations?: ElfsightLocation[];
            hosts?: ElfsightHost[];
          };
        };
      }
    >;
  };
  const widgets = payload.data?.widgets ?? payload.widgets ?? {};
  const widget = Object.values(widgets).find(
    (entry) =>
      entry?.data?.settings?.events && entry.data.settings.events.length > 0,
  );
  const settings = widget?.data?.settings;
  const events = settings?.events ?? [];
  const locations = settings?.locations ?? [];
  const hosts = settings?.hosts ?? [];
  const locationMap = new Map(
    locations.filter(Boolean).map((loc) => [loc.id ?? "", loc]),
  );
  const hostMap = new Map(
    hosts.filter(Boolean).map((host) => [host.id ?? "", host]),
  );

  return events
    .flatMap((event): ScrapedEvent[] => {
      const timezone: "America/New_York" = "America/New_York";
      const startInfo = parseElfsightDateTimeValue(event.start, timezone);
      if (!startInfo) return [];
      const endInfo = parseElfsightDateTimeValue(event.end, timezone);
      const duration =
        endInfo && endInfo.dt.isValid ? endInfo.dt.diff(startInfo.dt) : null;
      const locationId = Array.isArray(event.location)
        ? event.location[0]
        : event.location?.id;
      const hostId = Array.isArray(event.host) ? event.host[0] : event.host?.id;
      const location = locationId ? locationMap.get(locationId) : null;
      const host = hostId ? hostMap.get(hostId) : null;
      const sourceUrl = event.buttonLink?.value?.trim();
      const baseSourceId = event.id ?? host?.id ?? null;
      const isRecurring = Boolean(event.repeatPeriod || event.repeatFrequency);
      const occurrences = buildRecurringOccurrences(event, startInfo, timezone);

      return occurrences
        .map((occurrence): ScrapedEvent => {
          const startValue = formatOccurrenceDateTime(
            occurrence,
            startInfo.hasTime,
          );
          const endValue = duration
            ? formatOccurrenceDateTime(
                occurrence.plus(duration),
                startInfo.hasTime,
              )
            : endInfo
              ? parseElfsightDateTime(event.end, timezone)
              : null;
          const sourceEventId = isRecurring
            ? baseSourceId
              ? `${baseSourceId}:${startValue}`
              : null
            : baseSourceId;

          return {
            title: event.name?.trim() || "Untitled event",
            description: event.description?.trim() || "",
            start_datetime: startValue,
            end_datetime: endValue,
            timezone,
            location_name: location?.name || "Tech Square ATL",
            location_address: formatElfsightAddress(location),
            organizer: "Tech Square ATL",
            source_url:
              sourceUrl && sourceUrl.startsWith("http")
                ? sourceUrl
                : SOURCE_URL,
            source_event_id: sourceEventId,
          };
        })
        .filter((event) => Boolean(event.start_datetime));
    })
    .filter((event): event is ScrapedEvent => Boolean(event));
};

const fetchElfsightEvents = async (): Promise<ScrapedEvent[]> => {
  try {
    const response = await axios.get(ELFSIGHT_BOOT_URL, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });
    return extractElfsightEvents(response.data);
  } catch {
    return [];
  }
};

const extractEvents = (html: string): ScrapedEvent[] => {
  const $ = cheerio.load(html);

  const jsonLdEvents: ScrapedEvent[] = [];
  $("script[type='application/ld+json']").each((_: number, el: AnyNode) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      jsonLdEvents.push(...parseJsonLdEvents(parsed, "Tech Square ATL"));
    } catch {
      // ignore malformed json-ld
    }
  });

  if (jsonLdEvents.length > 0) {
    return jsonLdEvents.map((event) => ({
      ...event,
      source_url: event.source_url || SOURCE_URL,
    }));
  }

  const events: ScrapedEvent[] = [];
  $("time").each((_: number, el: AnyNode) => {
    const timeEl = $(el);
    const container = timeEl.closest("article, li, div");
    const dateText = timeEl.text().trim();
    if (!dateText) return;

    const link = container.find("a").first();
    const href = link.attr("href") || "";
    const title =
      link.text().trim() || container.find("h1,h2,h3,h4").first().text().trim();
    if (!href || !title) return;
    if (!href.includes("/events")) return;

    const timeText = container.find("time").last().text().trim();
    const parsed = parseDate(dateText, timeText === dateText ? null : timeText);

    events.push({
      title,
      description: container.find("p").first().text().trim(),
      start_datetime: parsed?.start ?? dateText,
      end_datetime: parsed?.end ?? null,
      timezone: "America/New_York",
      location_name:
        container.find(".location, .event-location").first().text().trim() ||
        "Tech Square ATL",
      location_address: null,
      organizer: "Tech Square ATL",
      source_url: href.startsWith("http")
        ? href
        : new URL(href, SOURCE_URL).toString(),
      source_event_id: null,
    });
  });

  return events;
};

export const scrapeTechSquare = async (): Promise<ScrapedEvent[]> => {
  const elfsightEvents = await fetchElfsightEvents();
  if (elfsightEvents.length > 0) {
    return elfsightEvents;
  }

  const response = await axios.get(SOURCE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  let html = response.data as string;

  let events = extractEvents(html);
  if (events.length === 0) {
    const rendered = await tryRenderWithPlaywright();
    if (rendered) {
      html = rendered;
      events = extractEvents(html);
    }
  }

  return events;
};
