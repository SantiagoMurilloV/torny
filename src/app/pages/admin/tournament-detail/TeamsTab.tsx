import { useState, useMemo } from 'react';
import { Plus, Users } from 'lucide-react';
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

  const enrolledIds = useMemo(
    () => new Set(enrolledTeams.map((t) => t.id)),
    [enrolledTeams],
  );

  const teamsByCategory = useMemo(() => {
    const groups: Record<string, Team[]> = {};
    for (const team of enrolledTeams) {
      const cat = team.category || 'Sin Categoría';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(team);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Sin Categoría') return 1;
      if (b === 'Sin Categoría') return -1;
      return a.localeCompare(b);
    });
  }, [enrolledTeams]);

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
      {/* Single CTA — opens the picker which combines search + create.
          The previous flat <Select> dropdown didn't scale past ~30 teams
          and there was no way to reuse a team from a past tournament
          without scrolling the whole library. */}
      <div className="flex justify-end mb-6">
        <Button
          onClick={() => setShowPicker(true)}
          className="bg-spk-red hover:bg-spk-red-dark w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Inscribir equipo
        </Button>
      </div>

      {/* Teams grouped by category — each is a collapsible accordion so
          the page doesn't become an endless scroll. */}
      {teamsByCategory.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-black/20 mx-auto mb-3" />
          <p className="text-black/60">No hay equipos inscritos aún</p>
          <p className="text-sm text-black/40 mt-1">
            Tocá &ldquo;Inscribir equipo&rdquo; para empezar
          </p>
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
