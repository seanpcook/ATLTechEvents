-- CreateEnum
CREATE TYPE "Organizer" AS ENUM ('TECH_SQUARE_ATL', 'ATLANTA_TECH_VILLAGE', 'ATDC');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "start_datetime" TIMESTAMP(3) NOT NULL,
    "end_datetime" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "location_name" TEXT,
    "location_address" TEXT,
    "organizer" "Organizer" NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_event_id" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);
