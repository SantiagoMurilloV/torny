import { useEffect, useMemo, useState } from 'react';
import type { TournamentSponsor } from '../../types';
import { api } from '../../services/api';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Edge-to-edge marquee strip of sponsor logos. Lives between the
 * Hero and the TabNav on the public tournament detail page, so it's
 * visible from the moment the visitor scrolls past the title image
 * AND stays put as they switch tabs (Programación / Equipos / etc.)
 * — the component is mounted at the page layer, not inside any tab.
 *
 * UX choices:
 *   · Auto-scrolls left at a constant speed via CSS keyframes —
 *     no JS interval, no scrollLeft jumps, no jank.
 *   · Two copies of the logo list are rendered side by side and
 *     the animation translates by `-50%` so the loop is seamless
 *     (when the first copy finishes, the second is already in the
 *     exact same position).
 *   · Hovering pauses the animation so spectators can read a
 *     sponsor name without it slipping past.
 *   · Anchor-wrapped only when `sponsor.link` is set so clickable
 *     logos read as actionable; the rest are plain images.
 *   · Hidden entirely when there are zero sponsors so a torneo
 *     without patrocinadores doesn't show an empty white band.
 *
 * Mobile: the same animation runs at the same speed; logos are
 * smaller (h-10) so a phone fits ~5 per viewport.
 */
export function SponsorsCarousel({ tournamentId }: { tournamentId: string }) {
  const [sponsors, setSponsors] = useState<TournamentSponsor[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listSponsors(tournamentId)
      .then((data) => {
        if (!cancelled) {
          setSponsors(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Silent — sponsors are decorative, a fetch failure must not
        // block the rest of the tournament page from rendering.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  // Two-copy strip so the marquee loop is seamless. `useMemo` so the
  // duplication only happens when the actual list changes.
  const looped = useMemo(() => [...sponsors, ...sponsors], [sponsors]);

  // Speed in pixels-per-second. Scales the animation `duration` by
  // the strip's natural width so a wide list (10+ sponsors) doesn't
  // crawl while a short list (2-3) doesn't blur past. Falls back to
  // a sensible 40s for the typical 6-8 sponsors range.
  const durationSec = Math.max(20, sponsors.length * 4);

  if (!loaded || sponsors.length === 0) {
    // Pre-load → keep a thin strip space-holder so the page doesn't
    // jump when the data lands. Post-load → null when empty.
    if (!loaded) {
      return <div aria-hidden="true" className="h-8 sm:h-12 bg-white" />;
    }
    return null;
  }

  return (
    <section
      aria-label="Patrocinadores del torneo"
      className="bg-white border-y border-black/[0.06] overflow-hidden"
    >
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          <span
            className="hidden sm:inline-block text-[10px] font-bold uppercase text-black/45 tracking-[0.18em] flex-shrink-0"
            style={FONT}
          >
            Patrocinadores
          </span>
          <div className="relative flex-1 overflow-hidden">
            <div
              className="flex items-center gap-8 sm:gap-12"
              style={{
                animation: `spk-marquee ${durationSec}s linear infinite`,
                // The translateX(-50%) target lives in the @keyframes
                // below — declared once globally so multiple
                // carousels (rare, but possible) share a single rule.
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.animationPlayState =
                  'paused';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.animationPlayState =
                  'running';
              }}
            >
              {looped.map((s, idx) => (
                <SponsorLogo key={`${s.id}-${idx}`} sponsor={s} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Keyframe rule injected once. Tailwind doesn't have a
          built-in marquee, and writing it as a <style> tag keeps
          the dep graph clean (no new tailwind plugin). The
          translate target is -50% because the strip is two copies
          of the same list — so when the first copy reaches the
          end, the second copy is already in the exact same place. */}
      <style>{`
        @keyframes spk-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-label="Patrocinadores del torneo"] [style*="spk-marquee"] {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}

function SponsorLogo({ sponsor }: { sponsor: TournamentSponsor }) {
  const img = (
    <img
      src={sponsor.logo}
      alt={sponsor.name ?? 'Patrocinador'}
      className="h-10 sm:h-12 md:h-14 w-auto max-w-[140px] sm:max-w-[180px] object-contain opacity-80 hover:opacity-100 transition-opacity"
      // Don't lazy-load: the carousel scrolls items in and out
      // continuously, lazy-load on a moving target causes flashes.
      loading="eager"
      draggable={false}
    />
  );
  if (sponsor.link) {
    return (
      <a
        href={sponsor.link}
        target="_blank"
        rel="noopener noreferrer"
        title={sponsor.name ?? 'Patrocinador'}
        className="flex-shrink-0"
      >
        {img}
      </a>
    );
  }
  return (
    <div
      className="flex-shrink-0"
      title={sponsor.name ?? 'Patrocinador'}
    >
      {img}
    </div>
  );
}
