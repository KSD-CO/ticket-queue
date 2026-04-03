import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight">
            <span className="gradient-text bg-gradient-to-r from-red-400 to-orange-500">
              VIBE
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 sm:flex">
          <Link
            href="/events"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text"
          >
            Events
          </Link>
          <Link
            href="/events?category=festival"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text"
          >
            Festivals
          </Link>
          <Link
            href="/events?category=concert"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text"
          >
            Concerts
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-sm font-medium text-text-muted transition-colors hover:text-text"
          >
            Admin
          </Link>
          <Link
            href="/events"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Buy Tickets
          </Link>
        </div>
      </div>
    </header>
  );
}
