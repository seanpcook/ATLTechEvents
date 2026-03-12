import axios from "axios";
import https from "https";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";
import type { ScrapedEvent } from "@/lib/eventModel";
import { parseJsonLdEvents } from "@/lib/sources/jsonLd";

const SOURCE_URL = "https://portal.atdc.org/s/events";
const AURA_EVENTS_URL =
  "https://portal.atdc.org/s/sfsites/aura?r=8&LTE.Listing.getAllEvents=1";
const AURA_APP = "siteforce:communityApp";
const ATDC_COM_SITE_ID = "a2N5e000000zG8lEAE";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ATDC_MAX_EVENTS = 75;
const ATDC_DETAIL_CONCURRENCY = 6;
const ATDC_REQUEST_HEADERS = {
  "User-Agent": USER_AGENT,
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const tryRenderWithPlaywright = async (): Promise<string | null> => {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
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
): { start: string; end: string | null } | null => {
  if (!dateText) return null;
  const dt = DateTime.fromFormat(dateText, "MMMM d, yyyy h:mm a", {
    zone: "America/New_York",
  });
  if (dt.isValid) {
    return { start: dt.toISO() ?? dateText, end: null };
  }
  const dtAlt = DateTime.fromFormat(dateText, "MMMM d, yyyy", {
    zone: "America/New_York",
  });
  if (dtAlt.isValid) {
    return { start: dtAlt.toISODate() ?? dateText, end: null };
  }
  return null;
};

type AuraEvent = {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
};

type AuraEventRecord = {
  startDateTime?: string;
  endDateTime?: string;
  timeZone?: string;
  locationAndDate?: string;
};

const parseAuraDate = (value?: string | null): string | null => {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: "America/New_York" });
  if (!dt.isValid) return value;
  return dt.toISODate() ?? value;
};

const parseAuraDateTime = (value?: string | null): string | null => {
  if (!value) return null;
  const formats = ["yyyy-M-d h:mm a", "yyyy-MM-dd h:mm a"];
  for (const format of formats) {
    const dt = DateTime.fromFormat(value, format, {
      zone: "America/New_York",
    });
    if (dt.isValid) return dt.toISO() ?? value;
  }
  const iso = DateTime.fromISO(value, { zone: "America/New_York" });
  if (iso.isValid) return iso.toISO() ?? value;
  return value;
};

const extractFwuid = (html: string): string | null => {
  const match = html.match(/auraFW\/javascript\/([^/]+)\//);
  return match ? match[1] : null;
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

const fetchAuraEventRecord = async (
  agent: https.Agent,
  fwuid: string,
  recordId: string,
): Promise<AuraEventRecord | null> => {
  try {
    const message = {
      actions: [
        {
          id: "1;a",
          descriptor:
            "apex://PagesApi.FontevaControllersController/ACTION$getObjectAndRoute",
          callingDescriptor: "markup://PagesApi:FontevaController",
          params: {
            recordId,
            isPreview: false,
            urlVars: JSON.stringify({ id: recordId, site: "" }),
          },
          version: null,
        },
      ],
    };
    const auraContext = {
      mode: "PROD",
      fwuid,
      app: AURA_APP,
      loaded: {},
      dn: [],
      globals: {},
      uad: true,
    };
    const body = new URLSearchParams({
      message: JSON.stringify(message),
      "aura.context": JSON.stringify(auraContext),
      "aura.pageURI": `/s/community-event?id=${recordId}`,
      "aura.token": "null",
    });

    const response = await axios.post(
      "https://portal.atdc.org/s/sfsites/aura?r=3&PagesApi.FontevaControllers.getObjectAndRoute=1",
      body.toString(),
      {
        headers: {
          ...ATDC_REQUEST_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        httpsAgent: agent,
      },
    );

    const record =
      response.data?.actions?.[0]?.returnValue?.params?.record ?? null;
    return record;
  } catch {
    return null;
  }
};

const fetchAuraEvents = async (agent: https.Agent): Promise<ScrapedEvent[]> => {
  try {
    const { data: html } = await axios.get(SOURCE_URL, {
      headers: ATDC_REQUEST_HEADERS,
      httpsAgent: agent,
    });
    const fwuid = extractFwuid(String(html));
    if (!fwuid) return [];

    const message = {
      actions: [
        {
          id: "1;a",
          descriptor: "apex://LTE.ListingController/ACTION$getAllEvents",
          callingDescriptor: "markup://LTE:EventListing",
          params: { comSiteId: ATDC_COM_SITE_ID },
          version: null,
        },
      ],
    };
    const auraContext = {
      mode: "PROD",
      fwuid,
      app: AURA_APP,
      loaded: {},
      dn: [],
      globals: {},
      uad: true,
    };
    const body = new URLSearchParams({
      message: JSON.stringify(message),
      "aura.context": JSON.stringify(auraContext),
      "aura.pageURI": "/s/events",
      "aura.token": "null",
    });

    const response = await axios.post(AURA_EVENTS_URL, body.toString(), {
      headers: {
        ...ATDC_REQUEST_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      httpsAgent: agent,
    });

    const events =
      (response.data?.actions?.[0]?.returnValue?.events as AuraEvent[]) ?? [];
    const now = DateTime.now().setZone("America/New_York");
    const candidates = events
      .map((event) => {
        const start = parseAuraDate(event.startDate);
        const startDate = start
          ? DateTime.fromISO(start, { zone: "America/New_York" })
          : null;
        return { event, startDate };
      })
      .filter(
        (entry) => entry.startDate && entry.startDate >= now.startOf("day"),
      )
      .sort((a, b) =>
        a.startDate && b.startDate
          ? a.startDate.toMillis() - b.startDate.toMillis()
          : 0,
      )
      .slice(0, ATDC_MAX_EVENTS)
      .map((entry) => entry.event);

    const detailed = await mapWithConcurrency(
      candidates,
      ATDC_DETAIL_CONCURRENCY,
      async (event): Promise<ScrapedEvent | null> => {
        const title = event.displayName?.trim() || event.name?.trim();
        if (!title) return null;
        if (!event.id) return null;

        const detail = await fetchAuraEventRecord(agent, fwuid, event.id);
        const start =
          parseAuraDateTime(detail?.startDateTime) ??
          parseAuraDate(event.startDate);
        if (!start) return null;
        const end =
          parseAuraDateTime(detail?.endDateTime) ??
          parseAuraDate(event.endDate);

        const startDateTime = DateTime.fromISO(start, {
          zone: "America/New_York",
        });
        if (startDateTime.isValid && startDateTime < now.startOf("day")) {
          return null;
        }

        const sourceUrl = event.url
          ? new URL(event.url, "https://portal.atdc.org").toString()
          : SOURCE_URL;

        return {
          title,
          description: event.description?.trim() || "",
          start_datetime: start,
          end_datetime: end && end !== start ? end : null,
          timezone: "America/New_York",
          location_name: "ATDC",
          location_address: null,
          organizer: "ATDC",
          source_url: sourceUrl,
          source_event_id: event.id ?? null,
        };
      },
    );

    return detailed.filter((event): event is ScrapedEvent => Boolean(event));
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
      jsonLdEvents.push(...parseJsonLdEvents(parsed, "ATDC"));
    } catch {
      // ignore
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

    const parsed = parseDate(dateText);

    events.push({
      title,
      description: container.find("p").first().text().trim(),
      start_datetime: parsed?.start ?? dateText,
      end_datetime: parsed?.end ?? null,
      timezone: "America/New_York",
      location_name: container.find(".location").first().text().trim() || null,
      location_address: null,
      organizer: "ATDC",
      source_url: href.startsWith("http")
        ? href
        : new URL(href, SOURCE_URL).toString(),
      source_event_id: null,
    });
  });

  return events;
};

export const scrapeATDC = async (): Promise<ScrapedEvent[]> => {
  const allowInsecureTls = process.env.ALLOW_INSECURE_TLS === "true";
  const agent = new https.Agent({
    rejectUnauthorized: !allowInsecureTls,
  });

  const auraEvents = await fetchAuraEvents(agent);
  if (auraEvents.length > 0) {
    return auraEvents;
  }

  const response = await axios.get(SOURCE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    httpsAgent: agent,
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
