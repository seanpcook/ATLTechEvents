export type Organizer = "Tech Square ATL" | "Atlanta Tech Village" | "ATDC";

export type EventRecord = {
  id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string | null;
  timezone: "America/New_York";
  location_name: string | null;
  location_address: string | null;
  organizer: Organizer;
  source_url: string;
  source_event_id: string | null;
  last_seen_at: string;
};

export type ScrapedEvent = Omit<EventRecord, "id" | "last_seen_at"> & {
  id?: string;
  last_seen_at?: string;
};
