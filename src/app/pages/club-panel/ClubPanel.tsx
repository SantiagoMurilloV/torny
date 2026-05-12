import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, Loader2, ArrowRight, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';
import type { Team } from '../../types';
import { TeamAvatar } from '../../components/TeamAvatar';
import { getErrorMessage } from '../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Club captain home (mig 028). Lists every team in the club so the
 * captain can pick one and edit its logo / plantel via the existing
 * TeamPanel — we just deep-link to `/team-panel/:teamId`. The backend's
 * `requireTeamAccess` middleware allows the navigation when the
 * team's `club_id` matches the JWT's `clubId`.
 *
 * No new editing UI here — kept intentionally minimal so the rich
 * roster experience the captain already knows is the SAME one the
 * club captain gets, just navigable across multiple teams.
 */
export function ClubPanel() {
  const navigate = useNavigate();
  const [clubName, setClubName] = useState<string>('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // /auth/me carries the club name for `club_captain` users (the
        // backend extends the user payload). Fall back to "" if absent
        // so the page still renders.
        const me = await api.getMe();
        const fallbackName =
          (me as { club?: { name?: string } }).club?.name ??
          (me as { username?: string }).username ??
          '';
        setClubName(fallbackName);
        // Now resolve the actual team list. /clubs/me/teams returns
        // only the IDs (lean); we call the standard /teams/:id for
        // each so the panel reuses the team payload shape (logo,
        // initials, colors) the existing TeamAvatar already eats.
        const { teamIds } = await api.clubs.meTeams();
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
      } catch (err) {
        toast.error(getErrorMessage(err, 'No se pudieron cargar los equipos del club'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-5">
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

      <p className="text-sm text-black/60">
        Tocá un equipo para subir su logo, agregar jugadoras al plantel y
        gestionar sus datos. Cada equipo tiene su propia categoría y plantel
        independiente.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-black/45">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Cargando equipos…
        </div>
      ) : teams.length === 0 ? (
        <div className="border-2 border-dashed border-black/15 rounded-sm p-8 text-center">
          <Users className="w-10 h-10 text-black/25 mx-auto mb-3" aria-hidden="true" />
          <p className="text-black/60 mb-1">Aún no hay equipos asociados a este club</p>
          <p className="text-xs text-black/40">
            El admin del torneo todavía no inscribió equipos a tu nombre, o
            todavía no fueron asociados al club. Contactá a la organización.
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
                <div className="font-bold text-base truncate" style={FONT}>
                  {team.name}
                </div>
                {team.category && (
                  <div className="text-xs text-black/55 truncate">{team.category}</div>
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
    </div>
  );
}
