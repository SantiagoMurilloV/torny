import spkLogo from '../../../imports/spk-cup-logo-v4-1.svg';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Home page footer: club brand on the left, developer magazine-byline
 * on the right, hairline + centered copyright below. Horizontal at
 * every viewport so the composition reads the same on phones.
 */
export function HomeFooter() {
  return (
    <footer className="bg-black text-white pt-8 md:pt-12 pb-6 md:pb-10 border-t border-white/10">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="flex flex-row items-center justify-between gap-3 sm:gap-6">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src={spkLogo}
              alt="Torny Logo"
              className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 flex-shrink-0"
            />
            <div className="min-w-0">
              <div
                className="text-base sm:text-lg md:text-xl font-bold tracking-tighter leading-tight"
                style={FONT}
              >
                SPiKE
              </div>
              <div className="text-[10px] sm:text-xs text-white/50 truncate">
                Club Deportivo Spike
              </div>
            </div>
          </div>

          <DeveloperSignature />
        </div>

        <div className="mt-6 md:mt-8 h-px w-full bg-white/[0.06]" />

        <div
          className="mt-4 md:mt-6 text-center text-[9px] sm:text-[11px] uppercase tracking-[0.14em] text-white/35"
          style={FONT}
        >
          &copy; 2026 · All Rights Reserved to the Developer.
        </div>
      </div>
    </footer>
  );
}

function DeveloperSignature() {
  return (
    <div className="inline-flex items-center gap-2 sm:gap-3 flex-shrink-0">
      <span className="font-mono text-sm sm:text-base text-spk-red/85" aria-hidden="true">
        &lt;/&gt;
      </span>
      <span className="w-px h-8 sm:h-10 bg-white/10" aria-hidden="true" />
      <span className="flex flex-col leading-tight">
        <span
          className="text-[8px] sm:text-[9px] text-spk-red/80 uppercase"
          style={{ ...FONT, letterSpacing: '0.24em' }}
        >
          Developed by
        </span>
        <span
          className="mt-0.5 text-xs sm:text-sm text-white/85"
          style={{ ...FONT, letterSpacing: '0.02em' }}
        >
          Santiago Murillo Valencia
        </span>
        <span
          className="text-[8px] sm:text-[10px] text-white/40 uppercase"
          style={{ ...FONT, letterSpacing: '0.2em' }}
        >
          Full-Stack Developer
        </span>
      </span>
    </div>
  );
}
