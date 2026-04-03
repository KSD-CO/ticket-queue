import { EVENTS, CATEGORIES, type MusicEvent } from "@/lib/events";
import { EventCard } from "@/components/event-card";
import Link from "next/link";

interface EventsPageProps {
  searchParams: Promise<{ category?: string; q?: string }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams;
  const category = params.category as MusicEvent["category"] | undefined;
  const query = params.q?.toLowerCase();

  let events = EVENTS;
  if (category) {
    events = events.filter((e) => e.category === category);
  }
  if (query) {
    events = events.filter(
      (e) =>
        e.title.toLowerCase().includes(query) ||
        e.tagline.toLowerCase().includes(query) ||
        e.venue.toLowerCase().includes(query) ||
        e.artists.some((a) => a.name.toLowerCase().includes(query)),
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">
          {category
            ? CATEGORIES.find((c) => c.value === category)?.label ?? "Events"
            : "All Events"}
        </h1>
        <p className="mt-2 text-text-secondary">
          {events.length} event{events.length !== 1 ? "s" : ""} found
        </p>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/events"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            !category
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-text-secondary hover:border-accent hover:text-accent"
          }`}
        >
          All
        </Link>
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.value}
            href={`/events?category=${cat.value}`}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              category === cat.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-secondary hover:border-accent hover:text-accent"
            }`}
          >
            {cat.label}
          </Link>
        ))}
      </div>

      {/* Grid */}
      {events.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {events.map((event) => (
            <EventCard key={event.slug} event={event} />
          ))}
        </div>
      ) : (
        <div className="mt-16 text-center">
          <p className="text-xl font-semibold text-text-secondary">No events found</p>
          <p className="mt-2 text-text-muted">Try a different category or search term.</p>
          <Link
            href="/events"
            className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            View All Events
          </Link>
        </div>
      )}
    </div>
  );
}
