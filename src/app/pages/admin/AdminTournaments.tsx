import { Plus, Search, Trash2, Users, Calendar, Loader2, Lock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useData } from '../../context/DataContext';
import { TournamentFormModal } from '../../components/admin/TournamentFormModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Tournament } from '../../types';
import { api, type CreateTournamentDto, type UpdateTournamentDto } from '../../services/api';
import { tournamentStatusColor, tournamentStatusLabel } from '../../lib/status';
import { getErrorMessage } from '../../lib/errors';

export function AdminTournaments() {
  const navigate = useNavigate();
  const { tournaments, loading, error, addTournament, updateTournament, deleteTournament, refreshTournaments } = useData();
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState<Tournament | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Quota from /auth/me — drives the "X/Y torneos de tu plan" badge and
  // the disabled state on the Create Tournament button.
  const [quota, setQuota] = useState<{ used: number; cap: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setQuota({
          used: me.ownedTournamentsCount,
          cap: me.tournamentQuota,
        });
      })
      .catch(() => {
        // Silently ignore — quota is informational; creation is still
        // server-enforced so the user gets a toast if they overflow.
      });
    return () => {
      cancelled = true;
    };
  }, [tournaments.length]);

  const atCap = quota !== null && quota.used >= quota.cap;

  const filteredTournaments = tournaments.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.club.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = tournamentStatusColor;
  const getStatusLabel = tournamentStatusLabel;

  const handleCreate = () => {
    setEditingTournament(undefined);
    setIsModalOpen(true);
  };

  /**
   * Click handler shared by the desktop "+ Crear Torneo" button and the
   * mobile "+" icon button. Centralises the quota check so the toast
   * copy stays in sync between the two surfaces.
   */
  const handleCreateClick = () => {
    if (atCap) {
      toast.error(
        `Alcanzaste el límite de ${quota!.cap} torneo${
          quota!.cap === 1 ? '' : 's'
        } de tu plan. Contactá al super administrador para ampliarlo.`,
      );
      return;
    }
    handleCreate();
  };

  const capTooltip = atCap
    ? 'Plan al tope — no podés crear más torneos'
    : undefined;

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setDeletingId(id);
    try {
      await deleteTournament(id);
      toast.success('Torneo eliminado correctamente');
      setPendingDeleteId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al eliminar torneo'));
      throw err; // keep dialog open so the user can retry
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (tournament: Tournament) => {
    if (editingTournament) {
      const dto: UpdateTournamentDto = {
        name: tournament.name,
        sport: tournament.sport,
        club: tournament.club,
        startDate: tournament.startDate.toISOString().split('T')[0],
        endDate: tournament.endDate.toISOString().split('T')[0],
        description: tournament.description,
        coverImage: tournament.coverImage,
        status: tournament.status,
        teamsCount: tournament.teamsCount,
        format: tournament.format,
        courts: tournament.courts,
        courtLocations: tournament.courtLocations,
        categories: tournament.categories,
        enrollmentDeadline: tournament.enrollmentDeadline ?? null,
        playersPerTeam: tournament.playersPerTeam,
        bracketMode: tournament.bracketMode,
        regulationText: tournament.regulationText ?? null,
        regulationPdf: tournament.regulationPdf ?? null,
      };
      await updateTournament(editingTournament.id, dto);
      toast.success('Torneo actualizado correctamente');
    } else {
      const dto: CreateTournamentDto = {
        name: tournament.name,
        sport: tournament.sport,
        club: tournament.club,
        startDate: tournament.startDate.toISOString().split('T')[0],
        endDate: tournament.endDate.toISOString().split('T')[0],
        description: tournament.description,
        coverImage: tournament.coverImage,
        logo: tournament.logo,
        status: tournament.status,
        teamsCount: tournament.teamsCount,
        format: tournament.format,
        courts: tournament.courts,
        courtLocations: tournament.courtLocations,
        categories: tournament.categories,
        enrollmentDeadline: tournament.enrollmentDeadline ?? null,
        playersPerTeam: tournament.playersPerTeam,
        bracketMode: tournament.bracketMode,
        regulationText: tournament.regulationText ?? null,
        regulationPdf: tournament.regulationPdf ?? null,
      };
      await addTournament(dto);
      toast.success('Torneo creado correctamente');
    }
  };

  if (loading.tournaments && tournaments.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
      </div>
    );
  }

  if (error.tournaments && tournaments.length === 0) {
    return (
      <div className="p-6 text-center py-16">
        <p className="text-red-600 mb-4">{error.tournaments}</p>
        <button
          onClick={() => refreshTournaments()}
          className="px-4 py-2 bg-spk-red text-white rounded-sm hover:bg-spk-red-dark transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            GESTIÓN DE TORNEOS
          </h1>
          <p className="text-black/60">
            Crea y administra los torneos del sistema
            {quota && (
              <>
                {' · '}
                <span className={atCap ? 'text-spk-red font-bold' : 'text-black/70 font-bold'}>
                  {quota.used} / {quota.cap} torneos de tu plan
                </span>
              </>
            )}
          </p>
        </div>
        {/* Desktop / tablet create button — hidden on mobile because the
            mobile layout collapses it into a "+" square right next to the
            search input below (see "Search & quick create" row). */}
        <button
          onClick={handleCreateClick}
          disabled={atCap}
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          title={capTooltip}
        >
          {atCap ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }} className="uppercase font-bold">Crear Torneo</span>
        </button>
      </div>

      {/* Search & quick create — `Filtros` was removed because it was a
          dead button (no onClick) cluttering the mobile layout. The "+"
          square only renders on mobile (md:hidden) since the desktop
          version already has the full "Crear Torneo" button up in the
          header row. */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/40" />
          <input
            type="text"
            placeholder="Buscar torneos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
          />
        </div>
        <button
          type="button"
          onClick={handleCreateClick}
          disabled={atCap}
          aria-label={atCap ? 'Plan al tope — no podés crear más torneos' : 'Crear torneo'}
          title={capTooltip ?? 'Crear torneo'}
          className="md:hidden flex-shrink-0 inline-flex items-center justify-center w-10 h-10 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {atCap ? <Lock className="w-5 h-5" aria-hidden="true" /> : <Plus className="w-5 h-5" aria-hidden="true" />}
        </button>
      </div>

      {/* Tournaments Grid — each card is now a single clickable surface
          that navigates into the tournament detail. Edit lives inside the
          detail (Ajustes Generales tab); delete stays here but as a
          floating icon with stopPropagation so it doesn't double-fire the
          card navigation. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredTournaments.map(tournament => (
          <div
            key={tournament.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/admin/tournaments/${tournament.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/admin/tournaments/${tournament.id}`);
              }
            }}
            aria-label={`Abrir ${tournament.name}`}
            // `shadow-md` rest / `shadow-xl` hover gives a soft drop on
            // the sides so cards lift off the white background even
            // before the cursor hits them. The previous `hover:shadow-lg`
            // alone left the cards visually flat at rest.
            className="group relative bg-white border-2 border-black/10 hover:border-black/30 rounded-sm overflow-hidden shadow-md hover:shadow-xl transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-spk-red/50"
          >
            {/* Tournament Image */}
            <div className="h-40 bg-gradient-to-br from-[#003087] to-[#E31E24] relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white text-center">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-2">
                    <Calendar className="w-8 h-8" />
                  </div>
                  <div className="text-sm font-medium opacity-90">
                    {tournament.startDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} — {tournament.endDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(tournament.status)}`}>
                  {getStatusLabel(tournament.status)}
                </span>
              </div>
              {/* Floating delete — lives on top of the gradient banner so
                  it has contrast without a solid bg on the card body.
                  stopPropagation keeps the card click isolated. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(tournament.id);
                }}
                disabled={deletingId === tournament.id}
                aria-label={`Eliminar torneo ${tournament.name}`}
                title="Eliminar torneo"
                className="absolute top-3 left-3 p-1.5 bg-black/40 hover:bg-spk-red text-white rounded-sm backdrop-blur-sm transition-colors disabled:opacity-50"
              >
                {deletingId === tournament.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              <h3 className="font-bold text-lg mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                {tournament.name}
              </h3>
              <p className="text-sm text-black/60 mb-4">
                {tournament.club}
              </p>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-black/60" />
                  <span>{tournament.teamsCount} equipos</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-black/60" />
                  <span>
                    {tournament.format === 'groups' && 'Fase de Grupos'}
                    {tournament.format === 'knockout' && 'Eliminación Directa'}
                    {tournament.format === 'groups+knockout' && 'Grupos + Eliminación'}
                    {tournament.format === 'league' && 'Liga'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredTournaments.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-black/40" />
          </div>
          <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            No se encontraron torneos
          </h3>
          <p className="text-black/60">
            Intenta con otros términos de búsqueda
          </p>
        </div>
      )}

      {/* Modal */}
      <TournamentFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        tournament={editingTournament}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Eliminar torneo"
        description="¿Estás seguro de que quieres eliminar este torneo? Esta acción no se puede deshacer y borrará también sus partidos y clasificaciones."
        confirmLabel="Eliminar"
        loading={deletingId !== null}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
