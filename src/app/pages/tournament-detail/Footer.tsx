import spkLogo from '../../../imports/spk-cup-logo-v4-1.svg';

/**
 * Bottom-of-page footer with the Torny mark + copyright. Kept
 * minimal — the public pages share this same block.
 */
export function Footer() {
  return (
    <footer className="bg-black text-white py-12 border-t border-white/10 mt-20">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src={spkLogo} alt="Torny Logo" className="w-16 h-16" />
            <div>
              <div
                className="text-xl font-bold tracking-tighter"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Torny
              </div>
              <div className="text-xs text-white/50">Club Deportivo Spike</div>
            </div>
          </div>
          <div className="text-sm text-white/50">
            &copy; 2026 Torny. Todos los derechos reservados.
          </div>
        </div>
      </div>
    </footer>
  );
}
