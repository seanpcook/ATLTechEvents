import { DateTime } from "luxon";
import prisma from "@/lib/db";
import { normalizeEvent } from "@/lib/normalize";
import { scrapeTechSquare } from "@/lib/sources/techSquare";
import { scrapeAtlantaTechVillage } from "@/lib/sources/atlantaTechVillage";
import { scrapeATDC } from "@/lib/sources/atdc";
import type { EventRecord, Organizer } from "@/lib/eventModel";

const organizerToEnum = (
  organizer: Organizer,
): "TECH_SQUARE_ATL" | "ATLANTA_TECH_VILLAGE" | "ATDC" => {
  switch (organizer) {
    case "Tech Square ATL":
      return "TECH_SQUARE_ATL";
    case "Atlanta Tech Village":
      return "ATLANTA_TECH_VILLAGE";
    case "ATDC":
      return "ATDC";
  }
};

const upsertEvent = async (event: EventRecord): Promise<void> => {
  await prisma.event.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      title: event.title,
      description: event.description,
      startDatetime: new Date(event.start_datetime),
      endDatetime: event.end_datetime ? new Date(event.end_datetime) : null,
      timezone: event.timezone,
      locationName: event.location_name,
      locationAddress: event.location_address,
      organizer: organizerToEnum(event.organizer),
      sourceUrl: event.source_url,
      sourceEventId: event.source_event_id,
      lastSeenAt: new Date(event.last_seen_at),
    },
    update: {
      title: event.title,
      description: event.description,
      startDatetime: new Date(event.start_datetime),
      endDatetime: event.end_datetime ? new Date(event.end_datetime) : null,
      timezone: event.timezone,
      locationName: event.location_name,
      locationAddress: event.location_address,
      organizer: organizerToEnum(event.organizer),
      sourceUrl: event.source_url,
      sourceEventId: event.source_event_id,
      lastSeenAt: new Date(event.last_seen_at),
    },
  });
};

const runScrapers = async (): Promise<EventRecord[]> => {
  const [techSquare, techVillage, atdc] = await Promise.all([
    scrapeTechSquare(),
    scrapeAtlantaTechVillage(),
    scrapeATDC(),
  ]);

  // eslint-disable-next-line no-console
  console.log(
    `Scraped counts - Tech Square: ${techSquare.length}, Atlanta Tech Village: ${techVillage.length}, ATDC: ${atdc.length}`,
  );

  return [...techSquare, ...techVillage, ...atdc].map(normalizeEvent);
};

const softDeleteOldEvents = async (): Promise<void> => {
  const cutoff = DateTime.now().minus({ days: 14 }).toJSDate();
  await prisma.event.deleteMany({
    where: {
      lastSeenAt: {
        lt: cutoff,
      },
    },
  });
};

const main = async () => {
  const events = await runScrapers();
  // eslint-disable-next-line no-console
  console.log(`Normalized events: ${events.length}`);
  let skipped = 0;
  let logged = 0;
  for (const event of events) {
    if (!event.title || !event.start_datetime || !event.source_url) {
      // skip invalid records
      skipped += 1;
      if (logged < 10) {
        // eslint-disable-next-line no-console
        console.log("Skipped event", {
          title: event.title,
          start_datetime: event.start_datetime,
          source_url: event.source_url,
          organizer: event.organizer,
        });
        logged += 1;
      }
      continue;
    }
    await upsertEvent(event);
  }
  // eslint-disable-next-line no-console
  console.log(
    `Upserted events: ${events.length - skipped}, skipped: ${skipped}`,
  );
  await softDeleteOldEvents();
};

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Scrape failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
