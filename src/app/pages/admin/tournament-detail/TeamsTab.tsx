import { useState, useMemo } from 'react';
import { Plus, Users, Search, X } from 'lucide-react';
import { Tournament, Team } from '../../../types';
import { Button } from '../../../components/ui/button';
import { CategorySection } from '../../../components/admin/CategorySection';
import { TeamFormModal } from '../../../components/admin/TeamFormModal';
import { TeamRosterCard } from '../../../components/admin/TeamRosterCard';
import { TeamPickerModal } from '../../../components/admin/TeamPickerModal';
import { ConfirmDialog } from '../../../components/ConfirmDialog';

interface TeamsTabProps {
  tournament: Tournament;
  enrolledTeams: Team[];
  /** Who's currently being un-enrolled, if any. Drives the per-row spinner. */
  unenrollingId: string | null;
  onEnroll: (teamId: string) => Promise<void>;
  onUnenroll: (teamId: string) => Promise<void>;
  /**
   * Fires on team-form submit. Parent routes to create-and-enrol or
   * edit-in-place based on whether `editingTeam` is passed here.
   */
  onTeamFormSubmit: (team: Team, editingTeam: Team | undefined) => Promise<void>;
}

/**
 * Equipos inscritos tab — enrolment controls, teams grouped by category,
 * per-team roster via TeamRosterCard. "Crear Equipo Nuevo" opens the
 * TeamFormModal in create mode; clicking the pencil on a team opens it
 * in edit mode. No separate /admin/teams page — everything is here.
 */
export function TeamsTab({
  tournament,
  enrolledTeams,
  unenrollingId,
  onEnroll,
  onUnenroll,
  onTeamFormSubmit,
}: TeamsTabProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showNewTeamModal, setShowNewTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | undefined>();
  // Pending un-enrollment — clicking the trash icon stages the team here
  // so the ConfirmDialog can show its name in the body copy. The dialog
  // calls onUnenroll(team.id) on confirm, which routes to the parent's
  // handleUnenroll → api.unenrollTeam. Modeling pending-confirm as a
  // full Team object (instead of just the id) avoids a second lookup
  // from `enrolledTeams` when rendering the dialog message.
  const [pendingUnenrollTeam, setPendingUnenrollTeam] = useState<Team | null>(null);
  // Free-text search over the inscribed roster — matches name / initials
  // / city. Filtering happens entirely client-side because the list is
  // already in memory; for large tournaments the input stays responsive
  // because it's just a `.filter` over a few hundred items at most.
  // The input only renders when there are enough teams to make scrolling
  // painful (>= 6), matching the captain-panel pattern so small
  // tournaments don't get visual clutter.
  const [search, setSearch] = useState('');

  const enrolledIds = useMemo(
    () => new Set(enrolledTeams.map((t) => t.id)),
    [enrolledTeams],
  );

  // Strip diacritics + lowercase so "Áñez" matches "anez" and "Cali"
  // matches "cali" regardless of how the admin types. Cheap enough to
  // re-run per render (string is short).
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const teamsByCategory = useMemo(() => {
    const term = normalize(search.trim());
    const matchesSearch = (t: Team): boolean => {
      if (term.length === 0) return true;
      return (
        normalize(t.name).includes(term) ||
        normalize(t.initials).includes(term) ||
        (t.city ? normalize(t.city).includes(term) : false)
      );
    };

    const groups: Record<string, Team[]> = {};
    for (const team of enrolledTeams) {
      if (!matchesSearch(team)) continue;
      const cat = team.category || 'Sin Categoría';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(team);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Sin Categoría') return 1;
      if (b === 'Sin Categoría') return -1;
      return a.localeCompare(b);
    });
  }, [enrolledTeams, search]);

  // Whether to render the search input — keep small tournaments tidy.
  // The threshold matches the player-search filter in TeamPanel.tsx.
  const showSearch = enrolledTeams.length >= 6;
  // Active search drives two behaviours: pin every visible category open
  // (so matches aren't hidden behind collapsed accordions) and surface
  // a "no results" state when the filter wipes everything out.
  const isSearching = search.trim().length > 0;

  const handleFormSubmit = async (team: Team) => {
    await onTeamFormSubmit(team, editingTeam);
  };

  const handleEnrollFromPicker = async (teamId: string) => {
    await onEnroll(teamId);
    // Picker stays open so the admin can keep enrolling without
    // re-opening it; the picked row flips to "Ya inscrito" once
    // enrolledTeams updates.
  };

  return (
    <>
      {/* Toolbar — single row: search input takes most of the width,
          a "+" icon button sits next to it on mobile and a full
          "+ Inscribir equipo" button on desktop. Mirrors the same
          pattern AdminTournaments uses so the admin sees a consistent
          shape across the app's "list + create" surfaces. The "+"
          button is always rendered — when there's no search input
          (small tournaments) the button still sits on the right. */}
      <div className="flex items-center gap-2 mb-6">
        {showSearch ? (
          <div className="relative flex-1 min-w-0">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, sigla o ciudad…"
              aria-label="Buscar equipo inscrito"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none bg-white"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black rounded-sm"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          // Spacer keeps the Inscribir button on the right when there's
          // no search input (small tournaments). Without it the button
          // would jump to the left edge on the flex row.
          <div aria-hidden="true" className="flex-1" />
        )}
        {/* Mobile: 40×40 icon button. */}
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          aria-label="Inscribir equipo"
          title="Inscribir equipo"
          className="sm:hidden flex-shrink-0 inline-flex items-center justify-center w-10 h-10 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
        </button>
        {/* Desktop: full label, same red treatment. */}
        <Button
          onClick={() => setShowPicker(true)}
          className="hidden sm:inline-flex bg-spk-red hover:bg-spk-red-dark"
        >
          <Plus className="w-4 h-4" />
          Inscribir equipo
        </Button>
      </div>

      {/* Teams grouped by category — each is a collapsible accordion so
          the page doesn't become an endless scroll. */}
      {enrolledTeams.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-black/20 mx-auto mb-3" />
          <p className="text-black/60">No hay equipos inscritos aún</p>
          <p className="text-sm text-black/40 mt-1">
            Tocá &ldquo;Inscribir equipo&rdquo; para empezar
          </p>
        </div>
      ) : teamsByCategory.length === 0 ? (
        // Search returned nothing — explain the empty state and offer a
        // one-tap clear so the admin doesn't have to delete the input
        // character by character.
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-black/20 mx-auto mb-3" aria-hidden="true" />
          <p className="text-black/60">
            Ningún equipo coincide con &ldquo;{search}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="mt-2 text-sm text-spk-red hover:underline"
          >
            Limpiar búsqueda
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {teamsByCategory.map(([category, teams]) => (
            <CategorySection
              key={category}
              title={category}
              count={teams.length}
              subtitle={`${teams.length} ${teams.length === 1 ? 'equipo' : 'equipos'}`}
              defaultOpen
              // Pin open while there's an active search so matches in
              // collapsed categories are visible without an extra click.
              forceOpen={isSearching ? true : undefined}
            >
              <div className="space-y-3">
                {teams.map((team) => (
                  <TeamRosterCard
                    key={team.id}
                    team={team}
                    onEditTeam={(t) => setEditingTeam(t)}
                    // Stage the team in pending state instead of un-enrolling
                    // immediately — the ConfirmDialog at the bottom of this
                    // component asks before firing the destructive call.
                    onDeleteTeam={(t) => setPendingUnenrollTeam(t)}
                    deletingTeam={unenrollingId === team.id}
                    deleteButtonLabel={(t) => `Desinscribir ${t.name} del torneo`}
                  />
                ))}
              </div>
            </CategorySection>
          ))}
        </div>
      )}

      <TeamPickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        enrolledIds={enrolledIds}
        allowedCategories={tournament.categories}
        onEnroll={handleEnrollFromPicker}
        onCreateNew={() => {
          setShowPicker(false);
          setShowNewTeamModal(true);
        }}
      />

      <TeamFormModal
        isOpen={showNewTeamModal || editingTeam !== undefined}
        onClose={() => {
          setShowNewTeamModal(false);
          setEditingTeam(undefined);
        }}
        onSubmit={handleFormSubmit}
        team={editingTeam}
        allowedCategories={tournament.categories}
      />

      {/* Confirm un-enrollment — `unenrollingId === pending.id` keeps the
          confirm button in its loading state while the request is in
          flight. The dialog stays open on error (ConfirmDialog catches
          throws); the parent surfaces the failure via toast. */}
      <ConfirmDialog
        open={pendingUnenrollTeam !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUnenrollTeam(null);
        }}
        title="¿Desinscribir equipo?"
        description={
          pendingUnenrollTeam
            ? `Vas a desinscribir a ${pendingUnenrollTeam.name} de ${tournament.name}. ` +
              'Sus partidos programados de este torneo se eliminarán y no podrá ser ' +
              'reinscrito automáticamente. Esta acción no se puede deshacer.'
            : ''
        }
        confirmLabel="Desinscribir"
        loading={
          pendingUnenrollTeam !== null &&
          unenrollingId === pendingUnenrollTeam.id
        }
        onConfirm={async () => {
          if (!pendingUnenrollTeam) return;
          await onUnenroll(pendingUnenrollTeam.id);
          setPendingUnenrollTeam(null);
        }}
      />
    </>
  );
}
