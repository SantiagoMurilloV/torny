import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2,
  Loader2,
  ArrowRight,
  Users,
  Share2,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';
import type { Team, Tournament } from '../../types';
import { TeamAvatar } from '../../components/TeamAvatar';
import { getErrorMessage } from '../../lib/errors';
import { ParentRegistrationLinkModal } from './ParentRegistrationLinkModal';
import { ClubPushPermissionGate } from './ClubPushPermissionGate';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Club captain home (mig 028 + 029).
 *
 * Sections:
 *   1. Header con el nombre del club.
 *   2. "Compartí el link de inscripción" — cards por torneo abierto
 *      en el que el club tiene equipos inscritos (mig 029). Click →
 *      modal con la URL pública + copy + share.
 *   3. Equipos del club — la lista clickeable que ya existía. Click →
 *      `/team-panel/:teamId` para subir logo, gestionar plantel,
 *      pasar jugadoras entre equipos del mismo club.
 *
 * ClubPushPermissionGate vive arriba como overlay invasivo (full
 * screen, sin backdrop dismiss, "ahora no" oculto 3s) para que el
 * capitán no se pierda los pings de inscripción.
 */
export function ClubPanel() {
  const navigate = useNavigate();
  const [clubName, setClubName] = useState<string>('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLinkTournament, setActiveLinkTournament] =
    useState<Tournament | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // /auth/me carries the club name for club_captain users.
        const me = await api.getMe();
        const fallbackName =
          (me as { club?: { name?: string } }).club?.name ??
          (me as { username?: string }).username ??
          '';
        setClubName(fallbackName);

        // Three fetches in parallel: teams of the club, full team
        // payloads (so the avatar has the logo + colors), and the
        // tournaments where the club has at least one team enrolled.
        const [{ teamIds }, fetchedTournaments] = await Promise.all([
          api.clubs.meTeams(),
          api.clubs.meTournaments().catch((err) => {
            // Don't fail the whole panel if /me/tournaments hiccups —
            // the team list is the primary content; the link cards are
            // a nice-to-have that the captain can retry on reload.
            // eslint-disable-next-line no-console
            console.warn('could not load tournaments:', err);
            return [] as Tournament[];
          }),
        ]);

        const fetched = await Promise.all(
          teamIds.map((id) =>
            api.getTeam(id).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn(`could not load team ${id}:`, err);
              return null;
            }),
          ),
        );
        setTeams(fetched.filter((t): t is Team => t !== null));
        setTournaments(fetchedTournaments);
      } catch (err) {
        toast.error(getErrorMessage(err, 'No se pudieron cargar los equipos del club'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Open torneos = those whose start_date is in the future. Same logic
  // the backend uses to keep the public link alive (`now < startDate`)
  // so the UI mirrors the server's truth — the captain shouldn't see
  // a "Generar link" CTA on a torneo whose link is already dead.
  const openTournaments = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tournaments.filter((t) => {
      // tournament.startDate is a Date — slice(0, 10) of ISO gives a
      // YYYY-MM-DD string for direct lexicographic comparison.
      const iso = t.startDate.toISOString().slice(0, 10);
      return iso > today;
    });
  }, [tournaments]);

  return (
    <>
      <ClubPushPermissionGate />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-sm bg-spk-red/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 sm:w-7 sm:h-7 text-spk-red" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider text-black/55 font-bold"
              style={FONT}
            >
              Panel del club
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight" style={FONT}>
              {clubName || 'TU CLUB'}
            </h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-black/45">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Cargando…
          </div>
        ) : (
          <>
            {/* ── Tournament link cards ─────────────────────────────── */}
            {openTournaments.length > 0 && (
              <section className="space-y-3">
                <header>
                  <h2
                    className="text-xs font-bold uppercase text-black/50 border-b border-black/10 pb-1.5"
                    style={{ ...FONT, letterSpacing: '0.08em' }}
                  >
                    Compartí el link de inscripción
                  </h2>
                  <p className="text-xs text-black/55 mt-2 leading-relaxed">
                    Compartilo con los papás de tus jugadoras. Llenan
                    los datos y aparecen en el plantel al instante.
                  </p>
                </header>

                <ul className="space-y-2">
                  {openTournaments.map((t) => (
                    <li
                      key={t.id}
                      className="bg-white border border-black/10 rounded-sm px-4 py-3 flex items-center gap-3"
                    >
                      {t.logo ? (
                        <img
                          src={t.logo}
                          alt={`Logo ${t.name}`}
                          className="w-10 h-10 rounded-sm object-contain bg-black/5 p-1 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-spk-red/10 flex items-center justify-center flex-shrink-0">
                          <Calendar
                            className="w-5 h-5 text-spk-red"
                            aria-hidden="true"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div
                          className="font-bold leading-tight truncate"
                          style={FONT}
                        >
                          {t.name}
                        </div>
                        <div className="text-[11px] text-black/55 mt-0.5">
                          {formatDateRange(t.startDate, t.endDate)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveLinkTournament(t)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm text-xs font-bold uppercase transition-colors"
                        style={{ ...FONT, letterSpacing: '0.05em' }}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Generar link
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── Teams list ───────────────────────────────────────── */}
            <section className="space-y-3">
              <header>
                <h2
                  className="text-xs font-bold uppercase text-black/50 border-b border-black/10 pb-1.5"
                  style={{ ...FONT, letterSpacing: '0.08em' }}
                >
                  Equipos del club
                </h2>
                <p className="text-xs text-black/55 mt-2 leading-relaxed">
                  Tocá un equipo para subir su logo, agregar jugadoras
                  y moverlas entre equipos del mismo club si te
                  inscribieron mal.
                </p>
              </header>

              {teams.length === 0 ? (
                <div className="border-2 border-dashed border-black/15 rounded-sm p-8 text-center">
                  <Users
                    className="w-10 h-10 text-black/25 mx-auto mb-3"
                    aria-hidden="true"
                  />
                  <p className="text-black/60 mb-1">
                    Aún no hay equipos asociados a este club
                  </p>
                  <p className="text-xs text-black/40">
                    El admin del torneo todavía no inscribió equipos a
                    tu nombre, o no fueron asociados al club. Contactá
                    a la organización.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => navigate(`/team-panel/${team.id}`)}
                      className="w-full flex items-center gap-3 bg-white border border-black/10 rounded-sm px-4 py-3 hover:border-spk-red hover:shadow-md transition-all text-left"
                    >
                      <TeamAvatar team={team} size="md" />
                      <div className="flex-1 min-w-0">
                        <div
                          className="font-bold text-base truncate"
                          style={FONT}
                        >
                          {team.name}
                        </div>
                        {team.category && (
                          <div className="text-xs text-black/55 truncate">
                            {team.category}
                          </div>
                        )}
                      </div>
                      <ArrowRight
                        className="w-4 h-4 text-black/40 flex-shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {activeLinkTournament && (
        <ParentRegistrationLinkModal
          isOpen
          onClose={() => setActiveLinkTournament(null)}
          tournament={activeLinkTournament}
        />
      )}
    </>
  );
}

function formatDateRange(start: Date, end: Date): string {
  try {
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();
    if (sameMonth) {
      const month = start.toLocaleDateString('es-CO', { month: 'long' });
      return `${start.getDate()}–${end.getDate()} ${month} ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
    })} – ${end.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}`;
  } catch {
    return '';
  }
}
