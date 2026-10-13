import { HOMEPAGE_SPONSORS } from "~/data/sponsors";

const PLACEHOLDER_MESSAGE =
  "Sponsorship options for Clisbot are being set up. Check back here when they are ready.";

export function SponsorClisbotSection() {
  return (
    <section>
      <h1 className="mb-4 text-3xl font-medium tracking-tight">Sponsor Clisbot</h1>
      <p className="max-w-2xl text-base text-muted-foreground">{PLACEHOLDER_MESSAGE}</p>
    </section>
  );
}

export function SponsorSection() {
  return (
    <section>
      <h2 className="mb-4 text-3xl font-medium tracking-tight">Sponsor Clisbot</h2>
      <p className="max-w-2xl text-base text-muted-foreground">
        {PLACEHOLDER_MESSAGE}{" "}
        <a href="/sponsor" className="underline hover:text-white/90">
          Sponsorship details
        </a>
      </p>
    </section>
  );
}

export function SponsorsSection() {
  if (HOMEPAGE_SPONSORS.length === 0) return null;
  return (
    <section>
      <h2 className="mb-4 text-3xl font-medium tracking-tight">Sponsors</h2>
      <ul className="grid grid-cols-2 gap-4">
        {HOMEPAGE_SPONSORS.map((sponsor) => (
          <li key={sponsor.href}>
            <a href={sponsor.href} target="_blank" rel="noopener noreferrer sponsored">
              <img src={sponsor.logo} alt={sponsor.name} className="max-h-10 max-w-full" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
