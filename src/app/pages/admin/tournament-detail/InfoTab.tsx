import { useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tournament } from '../../../types';
import type { UpdateTournamentDto } from '../../../services/api';
import { TournamentFormModal } from '../../../components/admin/TournamentFormModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { getErrorMessage } from '../../../lib/errors';

interface InfoTabProps {
  tournament: Tournament;
  /**
   * Persist the form's new values. Parent decides how to update its
   * local tournament state and show the toast for success — the tab
   * only awaits here to know the modal can close.
   */
  onSubmit: (updated: Tournament) => Promise<void>;
  /**
   * Flip status to 'completed'. Parent owns the actual update logic;
   * the tab only shows the confirmation dialog + spinner.
   */
  onFinalize: (tournament: Tournament) => Promise<Tournament>;
  /** Called with the server response so the parent can update state. */
  onFinalized: (fresh: Tournament) => void;
}

/**
 * Ajustes Generales — inline TournamentFormModal (no chrome) + a
 * clearly separated destructive "Finalizar torneo" action gated by
 * AlertDialog. Hidden once the tournament is already completed.
 */
export function InfoTab({ tournament, onSubmit, onFinalize, onFinalized }: InfoTabProps) {
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      const fresh = await onFinalize(tournament);
      onFinalized(fresh);
      toast.success('Torneo finalizado');
      setShowFinalizeDialog(false);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al finalizar el torneo'));
    } finally {
      setFinalizing(false);
    }
  };

  // The inline TournamentFormModal calls its onSubmit with a fully-
  // shaped Tournament; convert & delegate to the caller-provided hook.
  const handleFormSubmit = async (updated: Tournament) => {
    await onSubmit(updated);
  };

  return (
    <>
      <TournamentFormModal
        variant="inline"
        isOpen
        onClose={() => {}}
        onSubmit={handleFormSubmit}
        tournament={tournament}
      />

      {tournament.status !== 'completed' && (
        <div className="mt-8 pt-6 border-t border-black/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3
                className="text-sm font-bold uppercase tracking-wider text-black/70"
                style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  letterSpacing: '0.1em',
                }}
              >
                Finalizar torneo
              </h3>
              <p className="text-xs text-black/50 mt-0.5">
                Marca el torneo como completado. Podés seguir consultándolo,
                pero no aparecerá como "en curso" en listas y paneles.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFinalizeDialog(true)}
              disabled={finalizing}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-spk-win text-white hover:bg-spk-win/90 rounded-sm text-sm font-bold uppercase transition-colors disabled:opacity-50 flex-shrink-0"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
            >
              {finalizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Finalizar torneo
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Finalizar este torneo?</AlertDialogTitle>
            <AlertDialogDescription>
              El torneo pasará a estado <strong>Finalizado</strong>. Los
              marcadores, clasificaciones y cruces quedan como están —
              solo cambia el estado público. Podés revertirlo editando el
              estado desde este mismo formulario.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={finalizing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalize}
              disabled={finalizing}
              className="bg-spk-win hover:bg-spk-win/90"
            >
              {finalizing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Finalizar torneo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Re-export the DTO type so the orchestrator's submit can reference it cleanly. */
export type { UpdateTournamentDto };
