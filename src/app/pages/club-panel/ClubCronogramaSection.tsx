import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Loader2, Send } from 'lucide-react';
import type { Match, Team, Tournament } from '../../types';
import { api } from '../../services/api';
import { CronogramaTab as PublicCronograma } from '../tournament-detail/tabs/CronogramaTab';
import { getErrorMessage } from '../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface ClubCronogramaSectionProps {
  tournaments: Tournament[];
  clubTeams: Team[];
}

/**
 * Club-captain Cronograma. Renders read-only schedule views for each
 * tournament the club is enrolled in — but ONLY after the admin has
 * pressed "Enviar programación a clubes" (mig 032), which stamps
 * `tournament.scheduleSentToClubsAt`. Until that flag flips the
 * captain sees an empty-state pointing back at the admin.
 *
 * Reuses `tournament-detail/tabs/CronogramaTab` so the visual + UX
 * are identical to the public site — same court×time grid on
 * desktop, same cronological mobile list, same drag-disabled card
 * interactions. The only thing different: matches are pre-filtered
 * to the club's own teams BEFORE handing them to the inner grid.
 *
 * The legend up top maps each colour swatch to a category, computed
 * from the matches the captain actually sees (no point listing
 * categories the club doesn't have).
 */
export function ClubCronogramaSection({
  tournaments,
  clubTeams,
}: ClubCronogramaSectionProps) {
  // Only show torneos where the admin already published. Sorted so
  // active comes first (matches the order the API already returns).
  const publishedTournaments = useMemo(
    () => tournaments.filter((t) => Boolean(t.scheduleSentToClubsAt)),
    [tournaments],
  );

  const [selectedId, setSelectedId] = useState<string>(
    publishedTournaments[0]?.id ?? '',
  );

  // Keep `selectedId` in sync when the list of published tournaments
  // changes (admin just hit publish on a NEW torneo, or a previous
  // selection got removed). Picks the first published torneo as a
  // safe fallback.
  useEffect(() => {
    if (publishedTournaments.length === 0) {
      if (selectedId !== '') setSelectedId('');
      return;
    }
    if (!publishedTournaments.some((t) => t.id === selectedId)) {
      setSelectedId(publishedTournaments[0].id);
    }
  }, [publishedTournaments, selectedId]);

  const selectedTournament = useMemo(
    () => publishedTournaments.find((t) => t.id === selectedId) ?? null,
    [publishedTournaments, selectedId],
  );

  // Matches for the selected tournament. Fetched once per selection;
  // the underlying CronogramaTab keeps its own state for day /
  // category / search filters so we don't need to manage them here.
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTournament) {
      setMatches([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTournamentMatches(selectedTournament.id)
      .then((data) => {
        if (cancelled) return;
        setMatches(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err, 'No se pudo cargar la programación'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTournament]);

  // Set of THIS club's team ids — drives the match filter below so
  // the captain only sees fixtures involving their own teams.
  const clubTeamIds = useMemo(
    () => new Set(clubTeams.map((t) => t.id)),
    [clubTeams],
  );

  // Filter matches to those that involve at least one of the
  // captain's teams. Unresolved bracket slots (team id === '') are
  // dropped because they don't carry team info yet — the captain
  // will see them once the bracket resolves.
  const clubMatches = useMemo(
    () =>
      matches.filter((m) => {
        const t1 = m.team1?.id;
        const t2 = m.team2?.id;
        return (
          (t1 && clubTeamIds.has(t1)) || (t2 && clubTeamIds.has(t2))
        );
      }),
    [matches, clubTeamIds],
  );

  // ── Empty states ───────────────────────────────────────────────

  if (publishedTournaments.length === 0) {
    return <UnpublishedEmptyState />;
  }

  return (
    <section className="space-y-4">
      {/* Header "Programación del club" + descripción retirados
          (2026-05-13): la pestaña ya está rotulada con el botón
          de navegación, y el componente público embebido más
          abajo ya muestra el contador de partidos y la descripción
          contextual ("Mirá los partidos por día y cancha…"). Doble
          encabezado robaba dos pantallas de scroll en mobile. */}

      {/* Tournament picker — chips when several published torneos
          coexist, otherwise omitted to keep the panel quiet. */}
      {publishedTournaments.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {publishedTournaments.map((t) => {
            const isActive = t.id === selectedId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`px-3 py-1.5 rounded-sm text-sm font-bold transition-colors ${
                  isActive
                    ? 'bg-spk-red text-white'
                    : 'bg-black/5 text-black/70 hover:bg-black/10'
                }`}
                style={{ ...FONT, letterSpacing: '0.03em' }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Colour legend retirada (2026-05-13) — el cronograma público
          embebido más abajo ya muestra los chips de categoría
          activos como filtro pill arriba del grid, así que una
          segunda leyenda arriba duplicaba la información y comía
          espacio vertical en mobile (el público vive en celular). */}

      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-spk-red" />
        </div>
      ) : error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-sm text-red-700">
          {error}
        </div>
      ) : selectedTournament && clubMatches.length === 0 ? (
        <NoMatchesEmptyState tournamentName={selectedTournament.name} />
      ) : selectedTournament ? (
        // Reuse the public cronograma component AS-IS so the captain
        // gets the same mobile chronological list + desktop court×time
        // grid the spectators see. Matches are pre-filtered to club
        // teams so the inner filters (day / search / category) only
        // operate on the captain's own slate.
        <div className="-mx-1">
          <PublicCronograma
            tournament={selectedTournament}
            matches={clubMatches}
          />
        </div>
      ) : null}
    </section>
  );
}

function UnpublishedEmptyState() {
  return (
    <section className="space-y-3">
      <header>
        <h2
          className="text-xs font-bold uppercase text-black/50 border-b border-black/10 pb-1.5"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          Programación del club
        </h2>
      </header>
      <div className="relative overflow-hidden bg-gradient-to-br from-spk-black to-[#1a1a1a] text-white rounded-sm p-5">
        <div
          className="absolute top-0 right-0 w-32 h-32 bg-spk-red/20 rounded-full -translate-y-12 translate-x-12 blur-2xl pointer-events-none"
          aria-hidden="true"
        />
        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 rounded-sm bg-spk-red/20 flex items-center justify-center flex-shrink-0">
            <CalendarDays className="w-5 h-5 text-spk-red" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-base font-bold uppercase"
              style={{ ...FONT, letterSpacing: '0.04em' }}
            >
              Pendiente de publicación
            </h3>
            <p className="text-sm text-white/75 leading-relaxed mt-1">
              El organizador del torneo todavía no envió la
              programación. Apenas la envíe vas a recibir una
              notificación push y vas a ver acá los partidos de tus
              equipos en formato horario.
            </p>
            <p className="text-[11px] text-white/45 mt-2 flex items-center gap-1.5">
              <Send className="w-3 h-3" aria-hidden="true" />
              Se carga cuando el admin presiona "Enviar programación a clubes".
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function NoMatchesEmptyState({ tournamentName }: { tournamentName: string }) {
  return (
    <div className="bg-black/[0.03] border border-black/10 rounded-sm p-5 text-center">
      <CalendarDays className="w-8 h-8 text-black/30 mx-auto mb-2" aria-hidden="true" />
      <p className="text-sm text-black/65 leading-relaxed">
        Todavía no hay partidos programados para tus equipos en{' '}
        <span className="font-bold">{tournamentName}</span>.
      </p>
    </div>
  );
}
