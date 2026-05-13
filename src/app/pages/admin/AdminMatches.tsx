import { Plus, Search, Edit, Trash2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useData } from '../../context/DataContext';
import { MatchCard } from '../../components/MatchCard';
import { MatchFormModal } from '../../components/admin/MatchFormModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Match } from '../../types';
import type { CreateMatchDto, UpdateMatchDto } from '../../services/api';
import { getErrorMessage } from '../../lib/errors';

export function AdminMatches() {
  const navigate = useNavigate();
  const { matches, tournaments, loading, error, addMatch, updateMatch, deleteMatch, refreshMatches } = useData();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<Match | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filteredMatches = matches.filter(match => {
    const tournament = tournaments.find(t => t.id === match.tournamentId);
    const matchesSearch =
      match.team1.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      match.team2.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tournament?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || match.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusCounts = () => ({
    all: matches.length,
    live: matches.filter(m => m.status === 'live').length,
    upcoming: matches.filter(m => m.status === 'upcoming').length,
    completed: matches.filter(m => m.status === 'completed').length,
  });

  const statusCounts = getStatusCounts();

  const handleCreate = () => {
    setEditingMatch(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (match: Match) => {
    setEditingMatch(match);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setDeletingId(id);
    try {
      await deleteMatch(id);
      toast.success('Partido eliminado correctamente');
      setPendingDeleteId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al eliminar partido'));
      throw err; // keep dialog open so the user can retry
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (match: Match) => {
    if (editingMatch) {
      // Drop team ids when they're still the unresolved-slot
      // placeholder (`''` from resolveTeam(null)) — same reasoning
      // as MatchesTab.handleEditSubmit. The server keeps the
      // existing NULL team_id and just reschedules the slot.
      const dto: UpdateMatchDto = {
        tournamentId: match.tournamentId,
        ...(match.team1.id ? { team1Id: match.team1.id } : {}),
        ...(match.team2.id ? { team2Id: match.team2.id } : {}),
        date: match.date.toISOString().split('T')[0],
        time: match.time,
        court: match.court,
        referee: match.referee,
        status: match.status,
        phase: match.phase,
        groupName: match.group,
        scoreTeam1: match.score?.team1,
        scoreTeam2: match.score?.team2,
        duration: match.duration,
      };
      await updateMatch(editingMatch.id, dto);
      toast.success('Partido actualizado correctamente');
    } else {
      const dto: CreateMatchDto = {
        tournamentId: match.tournamentId,
        team1Id: match.team1.id,
        team2Id: match.team2.id,
        date: match.date.toISOString().split('T')[0],
        time: match.time,
        court: match.court,
        referee: match.referee,
        phase: match.phase,
        groupName: match.group,
      };
      await addMatch(dto);
      toast.success('Partido creado correctamente');
    }
  };

  if (loading.matches && matches.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
      </div>
    );
  }

  if (error.matches && matches.length === 0) {
    return (
      <div className="p-6 text-center py-16">
        <p className="text-red-600 mb-4">{error.matches}</p>
        <button
          onClick={() => refreshMatches()}
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
            GESTIÓN DE PARTIDOS
          </h1>
          <p className="text-black/60">Administra los partidos y actualiza resultados</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }} className="uppercase font-bold">Crear Partido</span>
        </button>
      </div>

      {/* Status Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setFilterStatus('all')}
          className={`p-4 rounded-sm border-2 transition-all ${
            filterStatus === 'all' ? 'border-spk-red bg-spk-red/10' : 'border-black/10 hover:border-spk-red/50'
          }`}
        >
          <div className="text-2xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>{statusCounts.all}</div>
          <div className="text-sm text-black/60">Todos</div>
        </button>
        <button
          onClick={() => setFilterStatus('live')}
          className={`p-4 rounded-sm border-2 transition-all ${
            filterStatus === 'live' ? 'border-spk-red bg-spk-red/10' : 'border-black/10 hover:border-spk-red/50'
          }`}
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <div className="w-2 h-2 bg-spk-red rounded-full animate-pulse"></div>
            <div className="text-2xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>{statusCounts.live}</div>
          </div>
          <div className="text-sm text-black/60">En Vivo</div>
        </button>
        <button
          onClick={() => setFilterStatus('upcoming')}
          className={`p-4 rounded-sm border-2 transition-all ${
            filterStatus === 'upcoming' ? 'border-spk-red bg-spk-red/10' : 'border-black/10 hover:border-spk-red/50'
          }`}
        >
          <div className="text-2xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>{statusCounts.upcoming}</div>
          <div className="text-sm text-black/60">Próximos</div>
        </button>
        <button
          onClick={() => setFilterStatus('completed')}
          className={`p-4 rounded-sm border-2 transition-all ${
            filterStatus === 'completed' ? 'border-spk-red bg-spk-red/10' : 'border-black/10 hover:border-spk-red/50'
          }`}
        >
          <div className="text-2xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>{statusCounts.completed}</div>
          <div className="text-sm text-black/60">Finalizados</div>
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/40" />
          <input
            type="text"
            placeholder="Buscar partidos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
          />
        </div>
      </div>

      {/* Matches List */}
      <div className="space-y-4">
        {filteredMatches.map(match => (
          <div key={match.id} className="relative group">
            {/*
              Admin view: match cards are display-only. The row-level actions
              (referee console, edit, delete) are exposed as icon buttons in the
              overlay — the public match-detail page is not useful to an
              organizer, so we don't navigate on card click here.
            */}
            <MatchCard match={match} />
            {/* Action Buttons Overlay — admins only edit metadata and
                correct scores here. The live-scoring console belongs to
                the Judge role (/judge), so we don't surface a referee
                shortcut in this list anymore. */}
            <div className="absolute top-2 right-2 flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleEdit(match); }}
                aria-label={`Editar partido ${match.team1.name} vs ${match.team2.name}`}
                title="Editar partido"
                className="p-2 bg-white border-2 border-black/10 hover:border-spk-blue text-spk-blue rounded-sm shadow-lg transition-all"
              >
                <Edit className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleDelete(match.id); }}
                disabled={deletingId === match.id}
                aria-label={`Eliminar partido ${match.team1.name} vs ${match.team2.name}`}
                title="Eliminar partido"
                className="p-2 bg-white border-2 border-black/10 hover:border-spk-red text-spk-red rounded-sm shadow-lg transition-all disabled:opacity-50"
              >
                {deletingId === match.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredMatches.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-black/40" />
          </div>
          <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            No se encontraron partidos
          </h3>
          <p className="text-black/60">
            {filterStatus !== 'all'
              ? `No hay partidos ${filterStatus === 'live' ? 'en vivo' : filterStatus === 'upcoming' ? 'próximos' : 'finalizados'}`
              : 'Intenta con otros términos de búsqueda'}
          </p>
        </div>
      )}

      {/* Modal */}
      <MatchFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        match={editingMatch}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Eliminar partido"
        description="¿Estás seguro de que quieres eliminar este partido? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deletingId !== null}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
