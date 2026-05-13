import { useEffect, useRef, useState } from 'react';
import { Award, Loader2, Plus, Trash2, ExternalLink, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../services/api';
import type { Tournament, TournamentSponsor } from '../../../types';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { compressLogoImage } from '../../../lib/compressImage';
import { fileToDataUrl } from '../../../lib/fileToDataUrl';
import { getErrorMessage } from '../../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * "Patrocinadores" tab in the admin tournament panel (mig 033).
 *
 * Lets the admin upload sponsor logos one by one with optional
 * name + clickable link. Logos render in the public Hero / Info
 * strip on the spectator side.
 *
 * UX choices:
 *   · Each sponsor is a card with the logo, name, link, and
 *     remove button. No drag-reorder yet — added via the
 *     `reorderSponsors` endpoint when there's enough demand.
 *   · Upload flow: file picker → `compressLogoImage` to 256px
 *     WebP/JPEG (~5–25 KB) → `fileToDataUrl` so we ship a data
 *     URL inline. Same pattern as parent-registration and team
 *     logos — no separate file endpoint to maintain.
 *   · Optional name + link captured AFTER the upload through a
 *     two-step inline form so the captain doesn't have to fight
 *     a big create modal.
 */
export function SponsorsTab({
  tournament,
  onTournamentUpdated,
}: {
  /**
   * Tournament hydrated from the parent. Used to read the current
   * carousel speed so the slider can default to the persisted value
   * AND to fan out the optimistic update back to the parent after
   * a successful save so other places (the public SponsorsCarousel
   * preview, the Info tab) reflect the change without a refetch.
   */
  tournament: Tournament;
  onTournamentUpdated?: (next: Tournament) => void;
}) {
  const tournamentId = tournament.id;
  const [sponsors, setSponsors] = useState<TournamentSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carousel speed — slider value mirrors `tournament.sponsorsSpeedSeconds`.
  // Defaults to 40 (same as the DB column default) when null so the
  // slider doesn't render at the leftmost position the first time
  // the admin opens the tab. Saves on slider release, not on every
  // tick, to avoid hammering the backend.
  const [speed, setSpeed] = useState<number>(tournament.sponsorsSpeedSeconds ?? 40);
  const [savingSpeed, setSavingSpeed] = useState(false);

  useEffect(() => {
    setSpeed(tournament.sponsorsSpeedSeconds ?? 40);
  }, [tournament.sponsorsSpeedSeconds]);

  const handleSpeedCommit = async (next: number) => {
    if (savingSpeed) return;
    if (next === (tournament.sponsorsSpeedSeconds ?? 40)) return;
    setSavingSpeed(true);
    try {
      const updated = await api.updateTournament(tournament.id, {
        sponsorsSpeedSeconds: next,
      });
      onTournamentUpdated?.(updated);
      toast.success('Velocidad actualizada.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo actualizar la velocidad'));
      // Revert the slider to the last known persisted value so the
      // UI doesn't lie about what the server holds.
      setSpeed(tournament.sponsorsSpeedSeconds ?? 40);
    } finally {
      setSavingSpeed(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listSponsors(tournamentId)
      .then((data) => {
        if (!cancelled) setSponsors(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(getErrorMessage(err, 'No se pudieron cargar los patrocinadores'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Solo se permiten imágenes.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen no puede superar 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressLogoImage(file);
      const dataUrl = await fileToDataUrl(compressed);
      const created = await api.createSponsor(tournamentId, { logo: dataUrl });
      setSponsors((prev) => [...prev, created]);
      toast.success('Patrocinador agregado.');
      // Open the inline editor on the new sponsor so the admin can
      // add the name + link without hunting for the row.
      setEditingId(created.id);
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo subir el patrocinador'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSponsor(tournamentId, id);
      setSponsors((prev) => prev.filter((s) => s.id !== id));
      toast.success('Patrocinador eliminado.');
      setDeletingId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo eliminar'));
      throw err; // keep dialog open
    }
  };

  const handleUpdate = async (
    id: string,
    patch: { name?: string | null; link?: string | null },
  ) => {
    try {
      const updated = await api.updateSponsor(tournamentId, id, patch);
      setSponsors((prev) => prev.map((s) => (s.id === id ? updated : s)));
      toast.success('Patrocinador actualizado.');
      setEditingId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo actualizar'));
    }
  };

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-spk-red" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Header + uploader */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Award className="w-5 h-5 text-black/60" />
          <h2 className="text-xl font-bold" style={FONT}>
            PATROCINADORES
          </h2>
          {sponsors.length > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-sm bg-black text-white text-xs font-bold tabular-nums"
              style={FONT}
            >
              {sponsors.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-3 py-2 bg-spk-red hover:bg-spk-red-dark text-white text-sm font-bold rounded-sm transition-colors disabled:opacity-60"
          style={{ ...FONT, letterSpacing: '0.04em' }}
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span className="uppercase">Agregar logo</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </div>

      <p className="text-xs text-black/55 leading-relaxed">
        Los logos se van a ver en la página pública del torneo y en
        el panel de cada club. Recomendado: PNG con fondo
        transparente, cuadrado o casi cuadrado.
      </p>

      {/* Speed control. Slider has a wide range (10-300s per loop)
          so the admin can dial it from "frenetic" to "almost
          static". Saves on release (input onChange handles the
          live value; onMouseUp/onTouchEnd commits to the API). */}
      <div className="bg-black/[0.03] border border-black/10 rounded-sm p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-black/55" />
          <label
            htmlFor="sponsors-speed"
            className="text-[11px] font-bold uppercase text-black/65"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            Velocidad del carrusel
          </label>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-black/65 tabular-nums">
            {savingSpeed ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            ) : null}
            {speed}s por vuelta
          </span>
        </div>
        <input
          id="sponsors-speed"
          type="range"
          min={10}
          max={300}
          step={5}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          onMouseUp={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => {
            // Save on Enter / Tab / arrow-key release so keyboard
            // users get the same commit semantics as mouse/touch.
            if (['Enter', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              handleSpeedCommit(speed);
            }
          }}
          disabled={savingSpeed}
          className="w-full accent-spk-red"
          aria-label="Velocidad del carrusel"
        />
        <div className="flex justify-between text-[10px] text-black/45 font-medium">
          <span>Rápido (10s)</span>
          <span>Normal (40s)</span>
          <span>Lento (300s)</span>
        </div>
      </div>

      {sponsors.length === 0 ? (
        <div className="bg-black/[0.03] border border-dashed border-black/15 rounded-sm p-8 text-center">
          <Award className="w-8 h-8 text-black/25 mx-auto mb-3" />
          <p className="text-sm text-black/65">
            Todavía no agregaste patrocinadores. Tocá "Agregar logo"
            para subir el primero.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sponsors.map((s) => (
            <SponsorCard
              key={s.id}
              sponsor={s}
              isEditing={editingId === s.id}
              onEdit={() => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(patch) => handleUpdate(s.id, patch)}
              onAskDelete={() => setDeletingId(s.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        title="¿Eliminar patrocinador?"
        description="No se puede deshacer. El logo dejará de aparecer en la página pública y en el panel del club inmediatamente."
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => deletingId && handleDelete(deletingId)}
      />
    </div>
  );
}

interface SponsorCardProps {
  sponsor: TournamentSponsor;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { name?: string | null; link?: string | null }) => void;
  onAskDelete: () => void;
}

function SponsorCard({
  sponsor,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onAskDelete,
}: SponsorCardProps) {
  const [name, setName] = useState(sponsor.name ?? '');
  const [link, setLink] = useState(sponsor.link ?? '');

  useEffect(() => {
    if (isEditing) {
      setName(sponsor.name ?? '');
      setLink(sponsor.link ?? '');
    }
  }, [isEditing, sponsor]);

  return (
    <div className="bg-white border border-black/10 rounded-sm p-4 space-y-3 relative">
      <div className="aspect-[16/9] bg-black/[0.03] rounded-sm flex items-center justify-center overflow-hidden">
        <img
          src={sponsor.logo}
          alt={sponsor.name ?? 'Patrocinador'}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del patrocinador (opcional)"
            className="w-full px-3 py-2 text-sm border border-black/15 rounded-sm focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none"
          />
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link (opcional, ej. https://...)"
            className="w-full px-3 py-2 text-sm border border-black/15 rounded-sm focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSave({ name: name.trim() || null, link: link.trim() || null })}
              className="flex-1 px-3 py-2 bg-spk-red text-white text-xs font-bold rounded-sm uppercase"
              style={FONT}
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-3 py-2 bg-black/5 hover:bg-black/10 text-black/70 text-xs font-bold rounded-sm uppercase"
              style={FONT}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="font-bold text-sm truncate" title={sponsor.name ?? 'Sin nombre'}>
              {sponsor.name || <span className="text-black/40">Sin nombre</span>}
            </div>
            {sponsor.link && (
              <a
                href={sponsor.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-spk-red hover:underline flex items-center gap-1 truncate"
                title={sponsor.link}
              >
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{sponsor.link}</span>
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="flex-1 px-3 py-1.5 bg-black/5 hover:bg-black/10 text-black/70 text-xs font-bold rounded-sm uppercase"
              style={FONT}
            >
              Editar
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              aria-label="Eliminar patrocinador"
              className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
