import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Match, Team } from '../../types';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ApiError } from '../../services/api';
import { useData } from '../../context/DataContext';
import { getErrorMessage } from '../../lib/errors';

interface MatchFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (match: Match) => Promise<void>;
  match?: Match;
}

interface FieldErrors {
  tournamentId?: string;
  team1Id?: string;
  team2Id?: string;
  teams?: string;
  date?: string;
  time?: string;
  court?: string;
  sets?: string;
  server?: string;
}

function validate(formData: {
  tournamentId: string;
  team1Id: string;
  team2Id: string;
  date: string;
  time: string;
  court: string;
  status: string;
  sets: { team1: number; team2: number }[];
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!formData.tournamentId) {
    errors.tournamentId = 'Selecciona un torneo';
  }

  // Allow saving an "unresolved" slot: both team ids empty → it's a
  // bracket placeholder waiting for the upstream round, and the
  // admin should be able to reprogram its date / hour / court
  // without picking equipos. The cronograma + parent handlers strip
  // the empty ids before they hit the wire so the server keeps
  // team_id = NULL.
  const isUnresolvedSlot = !formData.team1Id && !formData.team2Id;

  if (!isUnresolvedSlot) {
    if (!formData.team1Id) {
      errors.team1Id = 'Selecciona el equipo 1';
    }
    if (!formData.team2Id) {
      errors.team2Id = 'Selecciona el equipo 2';
    }
  }

  if (formData.team1Id && formData.team2Id && formData.team1Id === formData.team2Id) {
    errors.teams = 'Los equipos deben ser diferentes';
  }

  if (!formData.date) {
    errors.date = 'La fecha es obligatoria';
  }

  if (!formData.time) {
    errors.time = 'La hora es obligatoria';
  }

  if (!formData.court.trim()) {
    errors.court = 'La cancha es obligatoria';
  }

  if (formData.status !== 'upcoming') {
    for (const set of formData.sets) {
      if (set.team1 < 0 || set.team2 < 0) {
        errors.sets = 'Los puntos de set no pueden ser negativos';
        break;
      }
    }
  }

  return errors;
}

export function MatchFormModal({ isOpen, onClose, onSubmit, match }: MatchFormModalProps) {
  const { teams, tournaments } = useData();

  const [formData, setFormData] = useState({
    tournamentId: '',
    team1Id: '',
    team2Id: '',
    date: '',
    time: '',
    court: 'Cancha Principal',
    referee: '',
    status: 'upcoming' as 'upcoming' | 'live' | 'completed',
    phase: 'Fase de Grupos',
    group: 'Grupo A',
    scoreTeam1: 0,
    scoreTeam2: 0,
    sets: [] as { team1: number; team2: number }[],
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (match) {
      setFormData({
        tournamentId: match.tournamentId,
        team1Id: match.team1.id,
        team2Id: match.team2.id,
        date: match.date.toISOString().split('T')[0],
        time: match.time,
        court: match.court,
        referee: match.referee || '',
        status: match.status,
        phase: match.phase,
        group: match.group || '',
        scoreTeam1: match.score?.team1 || 0,
        scoreTeam2: match.score?.team2 || 0,
        sets: match.sets || [],
      });
    }
  }, [match]);

  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setSubmitting(false);
    }
  }, [isOpen]);

  // Lock body scroll while the modal is open so wheel / touchmove
  // events don't pass through to the page underneath. Restored on
  // close (and on unmount, just in case).
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fieldErrors = validate(formData);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    // Both fields empty is the legitimate "unresolved bracket slot"
    // case (matches mig 030). For that path, synthesize the same
    // placeholder shape that `resolveTeam(null)` returns so the
    // downstream Match object stays a valid React tree (callers
    // already use the empty-string id as the signal to omit the
    // field on the wire).
    const isUnresolvedSlot = !formData.team1Id && !formData.team2Id;
    const placeholderTeam: Team = {
      id: '',
      name: '—',
      initials: '—',
      colors: { primary: '#E5E7EB', secondary: '#F3F4F6' },
    };
    const team1 = isUnresolvedSlot
      ? placeholderTeam
      : teams.find((t) => t.id === formData.team1Id);
    const team2 = isUnresolvedSlot
      ? placeholderTeam
      : teams.find((t) => t.id === formData.team2Id);

    if (!team1 || !team2) {
      setErrors({ teams: 'Por favor selecciona ambos equipos' });
      setSubmitting(false);
      return;
    }

    const newMatch: Match = {
      id: match?.id || `match-${Date.now()}`,
      tournamentId: formData.tournamentId,
      team1,
      team2,
      date: new Date(formData.date),
      time: formData.time,
      court: formData.court,
      referee: formData.referee || undefined,
      status: formData.status,
      phase: formData.phase,
      group: formData.group || undefined,
      score: formData.status !== 'upcoming' ? {
        team1: formData.scoreTeam1,
        team2: formData.scoreTeam2,
      } : undefined,
      sets: formData.sets.length > 0 ? formData.sets : undefined,
      duration: match?.duration,
    };

    try {
      await onSubmit(newMatch);
      onClose();
      if (!match) {
        setFormData({
          tournamentId: '',
          team1Id: '',
          team2Id: '',
          date: '',
          time: '',
          court: 'Cancha Principal',
          referee: '',
          status: 'upcoming',
          phase: 'Fase de Grupos',
          group: 'Grupo A',
          scoreTeam1: 0,
          scoreTeam2: 0,
          sets: [],
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrors({ server: err.message });
      } else {
        toast.error(getErrorMessage(err, 'Error de red al guardar partido'), {
          action: {
            label: 'Reintentar',
            onClick: () => handleSubmit(e),
          },
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const addSet = () => {
    setFormData({
      ...formData,
      sets: [...formData.sets, { team1: 0, team2: 0 }]
    });
  };

  const updateSet = (index: number, field: 'team1' | 'team2', value: number) => {
    const newSets = [...formData.sets];
    newSets[index][field] = value;
    setFormData({ ...formData, sets: newSets });
    setErrors((prev) => ({ ...prev, sets: undefined, server: undefined }));
  };

  const removeSet = (index: number) => {
    setFormData({
      ...formData,
      sets: formData.sets.filter((_, i) => i !== index)
    });
  };

  const inputClass = (field: keyof FieldErrors) =>
    `w-full px-4 py-2 border-2 rounded-sm focus:outline-none ${
      errors[field]
        ? 'border-red-500 focus:border-red-500'
        : 'border-black/10 focus:border-spk-red'
    }`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-sm shadow-2xl max-w-3xl w-full my-4 sm:my-8"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 sm:px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-xl sm:text-2xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            {match ? 'EDITAR PARTIDO' : 'CREAR PARTIDO'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-sm transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-h-[calc(92vh-120px)] sm:max-h-[calc(90vh-120px)] overflow-y-auto" noValidate>
          {/* Server error */}
          {errors.server && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
              {errors.server}
            </div>
          )}

          {/* Teams same error */}
          {errors.teams && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
              {errors.teams}
            </div>
          )}

          {/* Tournament */}
          <div>
            <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Torneo *
            </label>
            <select
              value={formData.tournamentId}
              onChange={(e) => { setFormData({ ...formData, tournamentId: e.target.value }); setErrors((prev) => ({ ...prev, tournamentId: undefined, server: undefined })); }}
              className={inputClass('tournamentId')}
            >
              <option value="">Selecciona un torneo</option>
              {tournaments.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {errors.tournamentId && <p className="mt-1 text-sm text-red-500">{errors.tournamentId}</p>}
          </div>

          {/* Teams */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Equipo 1 *
              </label>
              <select
                value={formData.team1Id}
                onChange={(e) => { setFormData({ ...formData, team1Id: e.target.value }); setErrors((prev) => ({ ...prev, team1Id: undefined, teams: undefined, server: undefined })); }}
                className={inputClass('team1Id')}
              >
                <option value="">Selecciona equipo</option>
                {teams.filter(t => t.id !== formData.team2Id).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {errors.team1Id && <p className="mt-1 text-sm text-red-500">{errors.team1Id}</p>}
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Equipo 2 *
              </label>
              <select
                value={formData.team2Id}
                onChange={(e) => { setFormData({ ...formData, team2Id: e.target.value }); setErrors((prev) => ({ ...prev, team2Id: undefined, teams: undefined, server: undefined })); }}
                className={inputClass('team2Id')}
              >
                <option value="">Selecciona equipo</option>
                {teams.filter(t => t.id !== formData.team1Id).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {errors.team2Id && <p className="mt-1 text-sm text-red-500">{errors.team2Id}</p>}
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Fecha *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => { setFormData({ ...formData, date: e.target.value }); setErrors((prev) => ({ ...prev, date: undefined, server: undefined })); }}
                className={inputClass('date')}
              />
              {errors.date && <p className="mt-1 text-sm text-red-500">{errors.date}</p>}
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Hora *
              </label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => { setFormData({ ...formData, time: e.target.value }); setErrors((prev) => ({ ...prev, time: undefined, server: undefined })); }}
                className={inputClass('time')}
              />
              {errors.time && <p className="mt-1 text-sm text-red-500">{errors.time}</p>}
            </div>
          </div>

          {/* Court & Referee */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Cancha *
              </label>
              <input
                type="text"
                value={formData.court}
                onChange={(e) => { setFormData({ ...formData, court: e.target.value }); setErrors((prev) => ({ ...prev, court: undefined, server: undefined })); }}
                className={inputClass('court')}
              />
              {errors.court && <p className="mt-1 text-sm text-red-500">{errors.court}</p>}
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Árbitro
              </label>
              <input
                type="text"
                value={formData.referee}
                onChange={(e) => setFormData({ ...formData, referee: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
              />
            </div>
          </div>

          {/* Phase & Group */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Fase *
              </label>
              {/*
                Phase used to be a hardcoded `<select>` with five legacy
                values (Fase de Grupos / Octavos / Cuartos de Final / …)
                — those don't match what the system actually generates
                today: matches carry phase strings like "Cuartos · Oro|
                Infantil Femenino" or "Grupos|Mayores Masculino". A
                strict select would silently fall back to the first
                option whenever the saved value didn't match, which is
                why editing a cuartos match showed "Fase de Grupos".

                A free-text input shows the real phase verbatim. The
                admin should rarely change it (the materializer manages
                bracket-stage phases automatically), but we keep it
                editable so legacy / hand-built matches can still be
                relabeled when needed.
              */}
              <input
                type="text"
                value={formData.phase}
                onChange={(e) => setFormData({ ...formData, phase: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Grupo (opcional)
              </label>
              <input
                type="text"
                value={formData.group}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                placeholder="Ej: Grupo A"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Estado *
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
            >
              <option value="upcoming">Próximo</option>
              <option value="live">En Vivo</option>
              <option value="completed">Finalizado</option>
            </select>
          </div>

          {/* Score (only if not upcoming) */}
          {formData.status !== 'upcoming' && (
            <div>
              <label className="block text-sm font-bold mb-4" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Marcador Final
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-black/60 mb-2">Sets {teams.find(t => t.id === formData.team1Id)?.name || 'Equipo 1'}</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={formData.scoreTeam1}
                    onChange={(e) => setFormData({ ...formData, scoreTeam1: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </div>
                <div>
                  <label className="block text-xs text-black/60 mb-2">Sets {teams.find(t => t.id === formData.team2Id)?.name || 'Equipo 2'}</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={formData.scoreTeam2}
                    onChange={(e) => setFormData({ ...formData, scoreTeam2: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Sets Detail */}
          {formData.status !== 'upcoming' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  Detalle de Sets
                </label>
                <button
                  type="button"
                  onClick={addSet}
                  className="px-3 py-1 bg-spk-blue text-white text-sm rounded-sm hover:bg-spk-blue/90 transition-colors"
                >
                  + Agregar Set
                </button>
              </div>
              {errors.sets && <p className="mb-2 text-sm text-red-500">{errors.sets}</p>}
              <div className="space-y-3">
                {formData.sets.map((set, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-sm font-bold w-12" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                      Set {index + 1}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={set.team1}
                      onChange={(e) => updateSet(index, 'team1', parseInt(e.target.value) || 0)}
                      className="flex-1 px-3 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                      placeholder="Puntos E1"
                    />
                    <span className="text-black/40">-</span>
                    <input
                      type="number"
                      min="0"
                      value={set.team2}
                      onChange={(e) => updateSet(index, 'team2', parseInt(e.target.value) || 0)}
                      className="flex-1 px-3 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                      placeholder="Puntos E2"
                    />
                    <button
                      type="button"
                      onClick={() => removeSet(index)}
                      className="p-2 text-spk-red hover:bg-spk-red/10 rounded-sm transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-3 bg-black/5 hover:bg-black/10 font-bold rounded-sm transition-colors disabled:opacity-50"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-3 bg-spk-red text-white hover:bg-spk-red-dark font-bold rounded-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {match ? 'Guardar Cambios' : 'Crear Partido'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
