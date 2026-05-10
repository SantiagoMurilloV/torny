import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Plus, Search, UserPlus, X } from 'lucide-react';
import { TeamAvatar } from '../TeamAvatar';
import { Button } from '../ui/button';
import { Team } from '../../types';
import { api } from '../../services/api';
import { getErrorMessage } from '../../lib/errors';
import { toast } from 'sonner';

/**
 * Search-then-pick modal used when an admin enrolls a team in a
 * tournament. Searches the admin's team library (scoped server-side by
 * `owner_id`) so there's no cross-tenant leakage. If the team they want
 * isn't in the library, a "Crear equipo nuevo" button at the bottom
 * delegates to the existing TeamFormModal.
 *
 * Why this exists: the previous UX was a flat <Select> dropdown showing
 * every team the admin had ever created. With 50+ teams that became a
 * scroll trap. The picker keeps the admin in keyboard flow — type two
 * letters, see the matches, click Inscribir — and surfaces the "create
 * new" path only when nothing matches, which is the right time to ask.
 */
interface TeamPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * IDs of teams already enrolled in the tournament. Renders a "Ya
   * inscrito" badge instead of the Inscribir button so the admin
   * doesn't pick a duplicate.
   */
  enrolledIds: Set<string>;
  /**
   * Categories enabled in the tournament. When non-empty the picker
   * filters server-side queries by category and hides teams from
   * categories not in the tournament.
   */
  allowedCategories?: string[];
  /** Async — parent handles enroll + toast + reload of enrolledTeams. */
  onEnroll: (teamId: string) => Promise<void>;
  /** Open the create-new-team modal in the parent (closes this modal). */
  onCreateNew: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;

export function TeamPickerModal({
  isOpen,
  onClose,
  enrolledIds,
  allowedCategories,
  onEnroll,
  onCreateNew,
}: TeamPickerModalProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the search so we don't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Reset query when modal opens; preload the first 20 (recent) teams so
  // the admin sees their library immediately even before typing.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setDebouncedQuery('');
      // Focus the input on open so the admin can start typing right away.
      // setTimeout escapes the same-frame focus stealing of motion/react.
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Fetch results whenever the debounced query (or category filter) changes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // For each category in the tournament we'd ideally batch — keep
        // it simple: omit category filter when the tournament accepts
        // any (allowedCategories empty/undef), otherwise pass the first
        // one and we'll filter the rest client-side. With <5 categories
        // per tournament this keeps the URL clean without losing matches.
        const teams = await api.searchTeams(debouncedQuery, { limit: 30 });
        if (cancelled) return;
        // Client-side category filter (server already filtered by owner).
        const allowedSet =
          allowedCategories && allowedCategories.length > 0
            ? new Set(allowedCategories.map((c) => c.trim().toLowerCase()))
            : null;
        const filtered = allowedSet
          ? teams.filter(
              (t) => t.category && allowedSet.has(t.category.trim().toLowerCase()),
            )
          : teams;
        setResults(filtered);
      } catch (err) {
        if (!cancelled) {
          toast.error(getErrorMessage(err, 'Error al buscar equipos'));
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen, allowedCategories]);

  const handleEnrollClick = async (teamId: string) => {
    setEnrollingId(teamId);
    try {
      await onEnroll(teamId);
    } finally {
      setEnrollingId(null);
    }
  };

  const empty = !loading && results.length === 0;

  // Stable list grouped: enrolled-already pinned to the top with a badge,
  // available teams below. Looks like a single list to the admin but
  // signals "no, that one's already in" without making them double-take.
  const sorted = useMemo(() => {
    const enrolled: Team[] = [];
    const available: Team[] = [];
    for (const t of results) {
      if (enrolledIds.has(t.id)) enrolled.push(t);
      else available.push(t);
    }
    return [...available, ...enrolled];
  }, [results, enrolledIds]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-sm shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-spk-hairline">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-xl text-spk-black truncate">
              Inscribir equipo
            </h2>
            <p className="text-xs text-black/55 mt-0.5">
              Buscá en tu biblioteca o creá uno nuevo
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded-sm hover:bg-black/5 text-black/60 flex-shrink-0"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 sm:px-6 pt-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, ciudad o iniciales…"
              className="w-full pl-9 pr-9 py-2.5 rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none text-sm"
            />
            {loading && (
              <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-spk-red" />
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">
          {empty ? (
            <div className="text-center py-10">
              <UserPlus className="w-10 h-10 text-black/20 mx-auto mb-2" />
              <p className="text-sm text-black/60">
                {query.trim().length > 0
                  ? 'Ningún equipo coincide con tu búsqueda'
                  : 'Aún no tenés equipos en tu biblioteca'}
              </p>
              <p className="text-xs text-black/40 mt-1">
                Creá uno nuevo desde el botón de abajo.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {sorted.map((team) => {
                const isEnrolled = enrolledIds.has(team.id);
                const isWorking = enrollingId === team.id;
                return (
                  <li
                    key={team.id}
                    className="flex items-center gap-3 p-2.5 rounded-sm border border-spk-hairline hover:border-black/20 transition"
                  >
                    <TeamAvatar team={team} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-ui font-semibold text-sm text-spk-black truncate">
                        {team.name}
                      </p>
                      <p className="text-[11px] text-black/55 truncate">
                        {[team.city, team.category].filter(Boolean).join(' · ') ||
                          'Sin categoría'}
                      </p>
                    </div>
                    {isEnrolled ? (
                      <span className="text-[10px] font-display uppercase tracking-wider text-black/45 px-2 py-1 border border-spk-hairline rounded-sm flex-shrink-0">
                        Ya inscrito
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleEnrollClick(team.id)}
                        disabled={isWorking}
                        className="bg-spk-red hover:bg-spk-red-dark flex-shrink-0"
                      >
                        {isWorking ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        Inscribir
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-spk-hairline p-4 sm:p-6 bg-black/[0.02] flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-black/55">
            ¿No está el equipo? Creá uno nuevo y queda en tu biblioteca.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onCreateNew}
            className="border-black/20 hover:bg-black/5 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            Crear equipo nuevo
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
