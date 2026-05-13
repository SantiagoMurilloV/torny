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

  // Marquee strip with enough copies that there's NEVER a visible
  // gap. The animation translates by -50% (which equals one full
  // copy of the list), so the second half is always identical to
  // the first half — that handles 1-N elements without re-tuning.
  //
  // Below ~6 unique logos the looped pair can still leave dead
  // space because a single copy is shorter than the viewport. We
  // fix that by duplicating each "half" until we have at least 10
  // elements per half (≈ enough for any reasonable phone or
  // desktop width). Then the full strip is 2 × that → seamless +
  // dense regardless of how few sponsors the admin uploaded.
  const looped = useMemo(() => {
    if (sponsors.length === 0) return [];
    const TARGET_PER_HALF = 10;
    const repeatsPerHalf = Math.max(
      1,
      Math.ceil(TARGET_PER_HALF / sponsors.length),
    );
    const half: typeof sponsors = [];
    for (let r = 0; r < repeatsPerHalf; r++) half.push(...sponsors);
    // Two identical halves so the -50% loop is seamless.
    return [...half, ...half];
  }, [sponsors]);

  // Speed scaled to the FULL strip width: more elements → longer
  // duration so the per-element speed stays roughly constant
  // regardless of how many repeats `looped` ended up with.
  const durationSec = Math.max(20, looped.length * 2.5);

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
        {/* Label "Patrocinadores" retirado (2026-05-13) — el contexto
            visual (logos de marca corriendo en un strip) ya es
            suficiente; el rótulo le robaba ancho útil al marquee y
            quedaba flotando solo en mobile. */}
        <div className="flex items-center gap-3">
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
