import axios from "axios";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";
import type { ScrapedEvent } from "@/lib/eventModel";
import { parseJsonLdEvents } from "@/lib/sources/jsonLd";

const SOURCE_URL = "https://www.atlantatechvillage.com/events/upcoming";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ATV_DETAIL_CONCURRENCY = 6;
const ATV_REQUEST_HEADERS = {
  "User-Agent": USER_AGENT,
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

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

const normalizeDateText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const parseWithFormats = (
  value: string,
  formats: string[],
): DateTime | null => {
  for (const format of formats) {
    const dt = DateTime.fromFormat(value, format, {
      zone: "America/New_York",
    });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(value, { zone: "America/New_York" });
  return iso.isValid ? iso : null;
};

const parseDateRange = (
  dateText: string,
): { start: string; end: string | null } | null => {
  const cleaned = normalizeDateText(dateText);
  if (!cleaned) return null;

  const separator = ["|", "•"].find((sep) => cleaned.includes(sep));
  let datePart = cleaned;
  let timePart: string | null = null;
  if (separator) {
    const [left, right] = cleaned.split(separator).map((part) => part.trim());
    datePart = left || cleaned;
    timePart = right || null;
  }

  const dateOnlyFormats = [
    "EEEE, MMMM d, yyyy",
    "EEEE, MMM d, yyyy",
    "MMMM d, yyyy",
    "MMM d, yyyy",
  ];
  const dateTimeFormats = [
    "EEEE, MMMM d, yyyy h:mm a",
    "EEEE, MMMM d, yyyy h:mma",
    "EEEE, MMM d, yyyy h:mm a",
    "EEEE, MMM d, yyyy h:mma",
    "MMMM d, yyyy h:mm a",
    "MMMM d, yyyy h:mma",
    "MMM d, yyyy h:mm a",
    "MMM d, yyyy h:mma",
  ];

  if (timePart) {
    const [startTime, endTime] = timePart
      .split(/\s*[-–]\s*/)
      .map((part) => part.trim());
    const startDt = parseWithFormats(
      `${datePart} ${startTime}`,
      dateTimeFormats,
    );
    if (!startDt) return null;
    const endDt = endTime
      ? parseWithFormats(`${datePart} ${endTime}`, dateTimeFormats)
      : null;
    return {
      start: startDt.toISO() ?? `${datePart} ${startTime}`,
      end: endDt ? (endDt.toISO() ?? `${datePart} ${endTime}`) : null,
    };
  }

  const dateOnlyDt = parseWithFormats(datePart, dateOnlyFormats);
  if (!dateOnlyDt) return null;
  return { start: dateOnlyDt.toISODate() ?? datePart, end: null };
};

const parseDateTimeText = (value: string): string | null => {
  const cleaned = normalizeDateText(value);
  const formats = [
    "MMMM d, yyyy h:mm a",
    "MMMM d, yyyy h:mma",
    "MMM d, yyyy h:mm a",
    "MMM d, yyyy h:mma",
  ];
  for (const format of formats) {
    const dt = DateTime.fromFormat(cleaned, format, {
      zone: "America/New_York",
    });
    if (dt.isValid) return dt.toISO() ?? cleaned;
  }
  return null;
};

const parseDateAndTime = (
  dateText: string,
  timeText: string,
): string | null => {
  const combined = `${normalizeDateText(dateText)} ${normalizeDateText(timeText)}`;
  return parseDateTimeText(combined);
};

const extractDetailTimes = (
  html: string,
): { start: string | null; end: string | null } => {
  const $ = cheerio.load(html);
  const candidates: string[] = [];

  $(".events-page").each((_: number, el: AnyNode) => {
    const text = $(el).text().trim();
    if (text) candidates.push(text);
  });

  const startText = candidates.find((text) =>
    /\d{4}.*\d{1,2}:\d{2}\s*[APap][Mm]/.test(text),
  );
  const start = startText ? parseDateTimeText(startText) : null;

  let end: string | null = null;
  const endLabel = candidates.find((text) =>
    text.toUpperCase().includes("END TIME"),
  );
  if (endLabel) {
    const endIndex = candidates.indexOf(endLabel);
    const endTimeText = candidates[endIndex + 1] ?? "";
    if (startText && endTimeText) {
      const datePart = startText.replace(/\s+\d{1,2}:\d{2}\s*[APap][Mm].*/, "");
      end = parseDateAndTime(datePart, endTimeText);
    }
  }

  return { start, end };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }).map(
    async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const extractWebflowEvents = (
  html: string,
  baseUrl: string,
): ScrapedEvent[] => {
  const $ = cheerio.load(html);
  const events: ScrapedEvent[] = [];

  $(".single-item").each((_: number, el: AnyNode) => {
    const container = $(el);
    const title = container.find(".event-title").first().text().trim();
    if (!title) return;

    const dateText = container.find(".event-date").first().text().trim();
    const description =
      container.find(".event-description").first().text().trim() || "";
    const href = container.find("a.event-button").attr("href") || "";
    if (!href) return;

    const parsed = parseDateRange(dateText);

    events.push({
      title,
      description,
      start_datetime: parsed?.start ?? dateText,
      end_datetime: parsed?.end ?? null,
      timezone: "America/New_York",
      location_name: "Atlanta Tech Village",
      location_address: null,
      organizer: "Atlanta Tech Village",
      source_url: href.startsWith("http")
        ? href
        : new URL(href, baseUrl).toString(),
      source_event_id: null,
    });
  });

  $(".event-display-item").each((_: number, el: AnyNode) => {
    const container = $(el);
    const link = container.find("a.event-display-link").first();
    const href = link.attr("href") || "";
    if (!href) return;
    const title = link.find("h1,h2,h3,h4").first().text().trim();
    if (!title) return;
    const dateText = link
      .find(".blog-display-publish-date")
      .first()
      .text()
      .trim();
    const description = link.find("p").first().text().trim() || "";
    const parsed = parseDateRange(dateText);

    events.push({
      title,
      description,
      start_datetime: parsed?.start ?? dateText,
      end_datetime: parsed?.end ?? null,
      timezone: "America/New_York",
      location_name: "Atlanta Tech Village",
      location_address: null,
      organizer: "Atlanta Tech Village",
      source_url: href.startsWith("http")
        ? href
        : new URL(href, baseUrl).toString(),
      source_event_id: null,
    });
  });

  return events;
};

const extractTimeTagEvents = (
  html: string,
  baseUrl: string,
): ScrapedEvent[] => {
  const $ = cheerio.load(html);
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

    const parsed = parseDateRange(dateText);

    events.push({
      title,
      description: container.find("p").first().text().trim(),
      start_datetime: parsed?.start ?? dateText,
      end_datetime: parsed?.end ?? null,
      timezone: "America/New_York",
      location_name: "Atlanta Tech Village",
      location_address: null,
      organizer: "Atlanta Tech Village",
      source_url: href.startsWith("http")
        ? href
        : new URL(href, baseUrl).toString(),
      source_event_id: null,
    });
  });
  return events;
};

export const scrapeAtlantaTechVillage = async (): Promise<ScrapedEvent[]> => {
  const fetchHtml = async (url: string): Promise<string> => {
    const response = await axios.get(url, {
      headers: ATV_REQUEST_HEADERS,
    });
    return response.data as string;
  };

  let html = await fetchHtml(SOURCE_URL);

  const $ = cheerio.load(html);
  const jsonLdEvents: ScrapedEvent[] = [];
  $("script[type='application/ld+json']").each((_: number, el: AnyNode) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      jsonLdEvents.push(...parseJsonLdEvents(parsed, "Atlanta Tech Village"));
    } catch {
      // ignore
    }
  });

  if (jsonLdEvents.length > 0) {
    return jsonLdEvents.map((event) => ({
      ...event,
      source_url: event.source_url || SOURCE_URL,
      location_name: event.location_name || "Atlanta Tech Village",
    }));
  }

  const seen = new Set<string>();
  const collected: ScrapedEvent[] = [];
  const addEvents = (items: ScrapedEvent[]) => {
    for (const item of items) {
      const key = `${item.source_url}|${item.start_datetime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
    }
  };

  const maxPages = 5;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = page === 1 ? SOURCE_URL : `${SOURCE_URL}?page=${page}`;
    const pageHtml = page === 1 ? html : await fetchHtml(pageUrl);
    const pageEvents = extractWebflowEvents(pageHtml, pageUrl);
    if (pageEvents.length === 0 && page > 1) break;
    addEvents(pageEvents);
  }

  if (collected.length > 0) {
    const needsDetail = collected.filter(
      (event) => !event.start_datetime.includes("T"),
    );
    if (needsDetail.length === 0) return collected;

    const enriched = await mapWithConcurrency(
      collected,
      ATV_DETAIL_CONCURRENCY,
      async (event): Promise<ScrapedEvent> => {
        if (event.start_datetime.includes("T")) return event;
        try {
          const detailHtml = await fetchHtml(event.source_url);
          const { start, end } = extractDetailTimes(detailHtml);
          if (!start) return event;
          return {
            ...event,
            start_datetime: start,
            end_datetime: end ?? event.end_datetime,
          };
        } catch {
          return event;
        }
      },
    );

    return enriched;
  }

  const rendered = await tryRenderWithPlaywright();
  if (rendered) {
    const renderedEvents = extractWebflowEvents(rendered, SOURCE_URL);
    if (renderedEvents.length > 0) return renderedEvents;
    return extractTimeTagEvents(rendered, SOURCE_URL);
  }

  return extractTimeTagEvents(html, SOURCE_URL);
};
