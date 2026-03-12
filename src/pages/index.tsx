import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import CalendarView from "@/components/CalendarView";
import EventList from "@/components/EventList";
import Filters from "@/components/Filters";
import { fetchEvents, type DateRange } from "@/lib/api";
import type { EventRecord, Organizer } from "@/lib/eventModel";

type ViewMode = "list" | "calendar";
type ThemeMode = "light" | "dark" | "system";

export default function Home() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizer, setOrganizer] = useState<Organizer | "all">("all");
  const [range, setRange] = useState<DateRange>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [theme, setTheme] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const prefersDark = media.matches;
      const isDark = theme === "dark" || (theme === "system" && prefersDark);
      root.classList.toggle("dark", isDark);
    };

    applyTheme();
    if (theme === "system") {
      const handler = () => applyTheme();
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    return undefined;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const nextTheme = useMemo<Record<ThemeMode, ThemeMode>>(
    () => ({
      system: "light",
      light: "dark",
      dark: "system",
    }),
    [],
  );

  const themeLabel =
    theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light";

  const toggleTheme = () => setTheme(nextTheme[theme]);

  useEffect(() => {
    if (view === "calendar" && range !== "all") {
      setRange("all");
    }
  }, [view, range]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchEvents(range, organizer)
      .then((data) => {
        if (!active) return;
        setEvents(data);
      })
      .catch(() => {
        if (!active) return;
        setError("Unable to load events right now.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [range, organizer]);

  return (
    <>
      <Head>
        <title>ATLTechEvents</title>
        <meta
          name="description"
          content="Unified calendar for Atlanta tech events."
        />
      </Head>
      <div className="min-h-screen bg-bg-primary text-text-primary">
        <header className="sticky top-0 z-40 border-b border-border-subtle bg-bg-primary/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-text-primary">
                ATLTechEvents
              </h1>
              <span className="text-sm text-text-secondary">
                Unified calendar for Atlanta tech events.
              </span>
            </div>
            <div className="flex flex-1 items-center justify-between gap-3 sm:flex-none">
              <div className="inline-flex rounded-full bg-bg-secondary p-1">
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    view === "list"
                      ? "bg-card-bg text-text-primary shadow-sm"
                      : "text-text-secondary"
                  }`}
                  onClick={() => setView("list")}
                >
                  List
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    view === "calendar"
                      ? "bg-card-bg text-text-primary shadow-sm"
                      : "text-text-secondary"
                  }`}
                  onClick={() => setView("calendar")}
                >
                  Calendar
                </button>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-card-bg px-3 py-2 text-sm font-semibold text-text-secondary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {theme === "dark" ? (
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364-.707.707M6.343 17.657l-.707.707m0-12.728.707.707M17.657 17.657l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"
                    />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"
                    />
                  </svg>
                )}
                <span>{themeLabel}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
          <Filters
            organizer={organizer}
            range={range}
            onOrganizerChange={setOrganizer}
            onRangeChange={setRange}
          />

          {loading && (
            <p className="text-sm text-text-secondary">Loading events…</p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}

          {!loading && !error && view === "list" && (
            <EventList events={events} />
          )}
          {!loading && !error && view === "calendar" && (
            <CalendarView events={events} />
          )}
        </main>

        <footer className="border-t border-border-subtle bg-bg-primary">
          <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-text-secondary">
            Events aggregated from publicly available sources. Click through for
            official details.
          </div>
        </footer>
      </div>
    </>
  );
}
