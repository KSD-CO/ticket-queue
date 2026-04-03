import Link from "next/link";
import { type MusicEvent, formatPrice, formatDate } from "@/lib/events";

export function EventCard({ event }: { event: MusicEvent }) {
  const lowestPrice = event.ticketTiers
    .filter((t) => t.available > 0)
    .sort((a, b) => a.price - b.price)[0];

  return (
    <Link href={`/events/${event.slug}`} className="group block">
      <article className="card-hover overflow-hidden rounded-2xl border border-border-subtle bg-bg-card">
        {/* Gradient artwork */}
        <div
          className="relative flex h-48 items-center justify-center sm:h-56"
          style={{
            background: `linear-gradient(135deg, ${event.imageGradient[0]}, ${event.imageGradient[1]})`,
          }}
        >
          <span className="text-6xl opacity-80 transition-transform group-hover:scale-110">
            {event.emoji}
          </span>

          {/* Category badge */}
          <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {event.category.replace("-", " ")}
          </span>

          {/* Sold out overlay */}
          {event.soldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="rounded-full bg-danger px-4 py-1.5 text-sm font-bold text-white">
                SOLD OUT
              </span>
            </div>
          )}

          {/* Queue badge */}
          {event.queueEnabled && !event.soldOut && (
            <span className="absolute right-3 top-3 rounded-full bg-accent/90 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              Queue Active
            </span>
          )}
        </div>

        {/* Info */}
        <div className="p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-text group-hover:text-accent-hover transition-colors">
            {event.title}
          </h3>
          <p className="mt-1 text-sm text-text-secondary line-clamp-1">{event.tagline}</p>

          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <span>{formatDate(event.date)}</span>
            <span className="text-border">|</span>
            <span>{event.venue}, {event.city}</span>
          </div>

          <div className="mt-4 flex items-center justify-between">
            {lowestPrice ? (
              <span className="text-sm font-semibold text-text">
                From {formatPrice(lowestPrice.price, lowestPrice.currency)}
              </span>
            ) : (
              <span className="text-sm font-semibold text-danger">Sold Out</span>
            )}
            <span className="text-xs font-medium text-accent group-hover:text-accent-hover transition-colors">
              View Details &rarr;
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
