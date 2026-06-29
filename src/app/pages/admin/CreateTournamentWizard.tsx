import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Sparkles,
  Loader2,
  Plus,
  X,
  CheckCircle2,
  Calendar,
  Users,
  MapPin,
  Clock,
  Trophy,
  Award,
  GitBranch,
  Zap,
  BarChart3,
  SlidersHorizontal,
  Activity,
} from 'lucide-react';
import { api, type CreateTournamentDto } from '../../services/api';
import { useData } from '../../context/DataContext';
import { TournamentAssistant } from '../../components/admin/TournamentAssistant';
import type { TournamentFormState } from '../../components/admin/tournament-form/types';
import { CATEGORIES, CATEGORY_BASES, GENDERS } from '../../lib/categories';

// ─── Constants ──────────────────────────────────────────────────────────────

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

const SPORTS = [
  { label: 'Voleibol' },
  { label: 'Fútbol' },
  { label: 'Básketbol' },
  { label: 'Handball' },
  { label: 'Tenis' },
  { label: 'Pádel' },
  { label: 'Rugby' },
  { label: 'Béisbol' },
  { label: 'Hockey' },
  { label: 'Otro' },
];

const TOURNAMENT_TYPES = [
  {
    id: 'copa-triangulares',
    name: 'Copa con Triangulares',
    Icon: Award,
    iconColor: 'text-yellow-600',
    iconBg: 'bg-yellow-50',
    badge: '24 equipos · 3 días',
    description: 'Fase de grupos → Clasificación Oro/Plata → Triangulares → Semifinales → Final',
    detail:
      'El formato más completo. Los equipos compiten en grupos, los mejores pasan a Copa Oro y los demás a Copa Plata. Cada copa tiene triangulares antes de las semis.',
    preset: {
      teamsCount: 24,
      format: 'groups+knockout' as const,
      bracketMode: 'divisions' as const,
      goldClassifiersPerGroup: 2,
      silverClassifiersPerGroup: 2,
      secondaryPhase: {
        enabled: true,
        groupsPerDivision: 4,
        teamsPerGroup: 4,
        classifiersPerGroup: 1,
        seedingMode: 'balanced' as const,
      },
    },
  },
  {
    id: 'grupos-eliminatoria',
    name: 'Grupos + Eliminatoria',
    Icon: GitBranch,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50',
    badge: '8-16 equipos · 2 días',
    description: 'Fase de grupos → Clasificados a llave directa',
    detail:
      'El formato más popular. Los equipos compiten en grupos y los mejores clasifican directamente a cuartos, semis y final.',
    preset: {
      teamsCount: 16,
      format: 'groups+knockout' as const,
      bracketMode: 'divisions' as const,
      goldClassifiersPerGroup: 2,
      silverClassifiersPerGroup: 2,
    },
  },
  {
    id: 'eliminatoria',
    name: 'Solo Eliminatoria',
    Icon: Zap,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-50',
    badge: '4-16 equipos · 1 día',
    description: 'Llave directa desde el primer partido',
    detail:
      'Ideal para torneos rápidos de un día. Un partido y el perdedor queda eliminado. Perfecto para previas o eventos cortos.',
    preset: {
      teamsCount: 8,
      format: 'knockout' as const,
    },
  },
  {
    id: 'liga',
    name: 'Liga',
    Icon: BarChart3,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-50',
    badge: '4-12 equipos · varios días',
    description: 'Todos contra todos, gana quien más puntos acumule',
    detail:
      'Cada equipo juega contra todos los demás. Se clasifica por puntos. Sin eliminación directa, el campeón es quien quede primero en la tabla.',
    preset: {
      teamsCount: 8,
      format: 'league' as const,
    },
  },
  {
    id: 'personalizado',
    name: 'Personalizado',
    Icon: SlidersHorizontal,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-50',
    badge: 'Libre configuración',
    description: 'Configura cada detalle según tus necesidades',
    detail:
      'Máximo control. Define el número de equipos, formato, canchas, horarios y todo lo que necesites para un torneo único.',
    preset: {},
  },
];

// Step order: 0=Método, 1=Deporte, 2=Tipo, 3=Info, 4=Fechas, 5=Canchas, 6=Cat., 7=Resumen
const STEP_LABELS = ['Método', 'Deporte', 'Tipo', 'Info', 'Fechas', 'Canchas', 'Cat.', 'Resumen'];

// ─── Wizard State ────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1
  creationMethod: 'manual' | 'ai' | null;
  // Step 2
  tournamentTypeId: string | null;
  // Step 3
  sport: string;
  name: string;
  club: string;
  city: string;
  description: string;
  // Step 4
  startDate: string;
  endDate: string;
  teamsCount: number;
  playersPerTeam: number;
  // Step 5
  courts: Array<{ name: string; location: string }>;
  dailyStartTime: string;
  dailyEndTime: string;
  matchBreakMinutes: number;
  matchDurationMinutes: number;
  // Step 6
  categories: string[];
  enrollmentDeadline: string;
  regulationText: string;
  // Preset-applied fields
  format: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  bracketMode: 'manual' | 'divisions';
  goldClassifiersPerGroup: number;
  silverClassifiersPerGroup: number;
  secondaryPhase: {
    enabled: boolean;
    groupsPerDivision: number;
    teamsPerGroup: number;
    classifiersPerGroup: number;
    seedingMode?: 'balanced' | 'divisions';
  } | null;
}

function initialState(): WizardState {
  return {
    creationMethod: null,
    tournamentTypeId: null,
    sport: 'Voleibol',
    name: '',
    club: '',
    city: '',
    description: '',
    startDate: '',
    endDate: '',
    teamsCount: 8,
    playersPerTeam: 12,
    courts: [
      { name: 'Cancha Principal', location: '' },
      { name: 'Cancha 2', location: '' },
    ],
    dailyStartTime: '08:00',
    dailyEndTime: '18:00',
    matchBreakMinutes: 15,
    matchDurationMinutes: 60,
    categories: [],
    enrollmentDeadline: '',
    regulationText: '',
    format: 'groups+knockout',
    bracketMode: 'manual',
    goldClassifiersPerGroup: 2,
    silverClassifiersPerGroup: 2,
    secondaryPhase: null,
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 py-4 px-4 overflow-x-auto">
      {STEP_LABELS.map((label, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isDone
                    ? 'bg-green-500 text-white'
                    : isActive
                      ? 'bg-spk-red text-white shadow-lg shadow-spk-red/30'
                      : 'bg-black/10 text-black/40'
                }`}
                style={FONT}
              >
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={`text-[9px] uppercase font-bold tracking-wide hidden sm:block ${
                  isActive ? 'text-spk-red' : isDone ? 'text-green-600' : 'text-black/30'
                }`}
                style={FONT}
              >
                {label}
              </span>
            </div>
            {i < total - 1 && (
              <div
                className={`h-0.5 w-6 sm:w-8 rounded-full transition-all ${isDone ? 'bg-green-400' : 'bg-black/10'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1 — Método ─────────────────────────────────────────────────────────

function Step1Method({
  value,
  onChange,
}: {
  value: WizardState['creationMethod'];
  onChange: (v: 'manual' | 'ai') => void;
}) {
  return (
    <div className="flex flex-col items-center gap-8 py-8 px-4 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold uppercase" style={FONT}>
          ¿Cómo querés crear tu torneo?
        </h2>
        <p className="text-black/60 mt-2 text-sm">Elegí el método que mejor se adapte a vos</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        {/* Manual */}
        <button
          type="button"
          onClick={() => onChange('manual')}
          className={`rounded-xl border-2 p-6 text-left cursor-pointer transition-all hover:shadow-lg group ${
            value === 'manual'
              ? 'border-spk-red bg-spk-red/5 shadow-lg'
              : 'border-black/10 hover:border-spk-red/50 bg-white'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all ${
              value === 'manual' ? 'bg-spk-red text-white' : 'bg-black/5 text-black/50 group-hover:bg-spk-red/10 group-hover:text-spk-red'
            }`}
          >
            <ClipboardList className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold uppercase mb-1" style={FONT}>
            Paso a paso
          </h3>
          <p className="text-sm text-black/60">Te guiamos por cada detalle de tu torneo</p>
          {value === 'manual' && (
            <div className="mt-3 flex items-center gap-1.5 text-spk-red text-xs font-bold" style={FONT}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Seleccionado
            </div>
          )}
        </button>

        {/* AI */}
        <button
          type="button"
          onClick={() => onChange('ai')}
          className={`rounded-xl border-2 p-6 text-left cursor-pointer transition-all hover:shadow-lg group relative overflow-hidden ${
            value === 'ai' ? 'border-transparent shadow-lg' : 'border-black/10 hover:border-purple-400/50 bg-white'
          }`}
        >
          {/* Gradient border for AI */}
          {value === 'ai' && (
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-purple-500 to-spk-red p-[2px]">
              <div className="absolute inset-[2px] rounded-[10px] bg-white/95" />
            </div>
          )}
          {value !== 'ai' && (
            <div className="absolute inset-0 rounded-xl pointer-events-none border-2 border-transparent group-hover:border-purple-300/50" />
          )}
          <div className="relative z-10">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all ${
                value === 'ai'
                  ? 'bg-gradient-to-br from-purple-500 to-spk-red text-white'
                  : 'bg-black/5 text-black/50 group-hover:bg-purple-100 group-hover:text-purple-600'
              }`}
            >
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-bold uppercase" style={FONT}>
                Torny IA
              </h3>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-500 to-spk-red text-white uppercase tracking-wide"
                style={FONT}
              >
                ✦ nuevo
              </span>
            </div>
            <p className="text-sm text-black/60">
              Describe tu torneo y nuestra IA lo configura por ti
            </p>
            {value === 'ai' && (
              <div
                className="mt-3 flex items-center gap-1.5 text-purple-600 text-xs font-bold"
                style={FONT}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Seleccionado
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Step Sport — Selección de deporte ───────────────────────────────────────

function StepSport({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-6 py-6 px-4 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold uppercase" style={FONT}>
          ¿Cuál es el deporte?
        </h2>
        <p className="text-black/60 mt-2 text-sm">Seleccioná el deporte del torneo</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {SPORTS.map((sport) => {
          const isSelected = value === sport.label;
          return (
            <button
              key={sport.label}
              type="button"
              onClick={() => onChange(sport.label)}
              className={`relative flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? 'border-spk-red bg-spk-red text-white shadow-lg'
                  : 'border-black/10 hover:border-spk-red/40 bg-white text-black/70'
              }`}
            >
              <Activity className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-black/30'}`} />
              <span className="font-bold uppercase text-sm" style={FONT}>
                {sport.label}
              </span>
              {isSelected && (
                <CheckCircle2 className="w-4 h-4 text-white absolute top-2 right-2" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 2 — Tipo de torneo ─────────────────────────────────────────────────

function Step2Type({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6 py-6 px-4 max-w-3xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold uppercase" style={FONT}>
          ¿Qué tipo de torneo es?
        </h2>
        <p className="text-black/60 mt-2 text-sm">Seleccioná el formato que mejor se ajuste a tu evento</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {TOURNAMENT_TYPES.map((type) => {
          const isSelected = value === type.id;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onChange(type.id)}
              className={`rounded-xl border-2 p-4 text-left cursor-pointer transition-all hover:shadow-md ${
                isSelected
                  ? 'border-spk-red bg-spk-red/5 shadow-md'
                  : 'border-black/10 hover:border-spk-red/40 bg-white'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${type.iconBg}`}>
                  <type.Icon className={`w-5 h-5 ${type.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-lg font-bold uppercase" style={FONT}>
                      {type.name}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        isSelected ? 'bg-spk-red text-white' : 'bg-black/8 text-black/50'
                      }`}
                      style={FONT}
                    >
                      {type.badge}
                    </span>
                  </div>
                  <p className="text-xs text-black/50 mb-1">{type.description}</p>
                  <p className="text-xs text-black/70 leading-relaxed hidden sm:block">{type.detail}</p>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-5 h-5 text-spk-red flex-shrink-0 mt-0.5" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 2 AI — TournamentAssistant wrapper ─────────────────────────────────

function Step2AI({
  formState,
  onApply,
  onContinue,
  hasSuggestions,
}: {
  formState: TournamentFormState;
  onApply: (patch: Partial<TournamentFormState>) => void;
  onContinue: () => void;
  hasSuggestions: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full h-full px-4">
      <div className="text-center pt-4">
        <h2 className="text-3xl sm:text-4xl font-bold uppercase" style={FONT}>
          ✦ Torny IA
        </h2>
        <p className="text-black/60 mt-1 text-sm">
          Describí tu torneo y la IA lo configurará automáticamente
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <TournamentAssistant formState={formState} onApplySuggestions={onApply} />
      </div>
      {hasSuggestions && (
        <div className="pb-4 flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="flex items-center gap-2 px-6 py-3 bg-spk-red hover:bg-spk-red-dark text-white font-bold rounded-lg transition-colors"
            style={FONT}
          >
            Continuar con este borrador
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Información básica ─────────────────────────────────────────────

function Step3Info({
  state,
  onChange,
  hideSport = false,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  hideSport?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 py-6 px-4 max-w-4xl mx-auto w-full">
      {/* Form */}
      <div className="lg:col-span-3 space-y-4">
        <div>
          <h2 className="text-3xl font-bold uppercase" style={FONT}>
            Información básica
          </h2>
          <p className="text-black/60 text-sm mt-1">Los datos principales de tu torneo</p>
        </div>

        {/* Sport badge — read-only when hideSport (already selected in previous step) */}
        {state.sport && (
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-spk-red" />
            <span className="text-sm font-bold text-spk-red uppercase" style={FONT}>{state.sport}</span>
            {!hideSport && <span className="text-xs text-black/40">(seleccionado antes)</span>}
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
            Nombre del torneo *
          </label>
          <input
            type="text"
            value={state.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Ej: Copa Valle 2026"
            className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
          />
        </div>

        {/* Club + City */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Club organizador *
            </label>
            <input
              type="text"
              value={state.club}
              onChange={(e) => onChange({ club: e.target.value })}
              placeholder="Ej: Club Los Andes"
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Ciudad
            </label>
            <input
              type="text"
              value={state.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Ej: Bogotá, Cundinamarca"
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
            Descripción
          </label>
          <textarea
            value={state.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Contá de qué se trata el torneo..."
            rows={3}
            className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm resize-none"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="lg:col-span-2">
        <div className="sticky top-4">
          <p className="text-xs font-bold uppercase text-black/40 mb-2" style={FONT}>
            Vista previa
          </p>
          <div className="rounded-xl border-2 border-black/10 overflow-hidden shadow-sm">
            <div className="h-24 bg-gradient-to-br from-[#003087] to-spk-red flex items-center justify-center">
              <Activity className="w-10 h-10 text-white/60" />
            </div>
            <div className="p-4">
              <p className="text-xs uppercase text-black/40 font-bold mb-0.5" style={FONT}>
                {state.sport}
              </p>
              <h3 className="text-xl font-bold uppercase" style={FONT}>
                {state.name || 'Nombre del torneo'}
              </h3>
              <p className="text-sm text-black/60 mt-0.5">{state.club || 'Club organizador'}</p>
              {state.city && (
                <p className="text-xs text-black/50 flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3" />
                  {state.city}
                </p>
              )}
              {state.description && (
                <p className="text-xs text-black/60 mt-2 line-clamp-2">{state.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4 — Fechas y equipos ───────────────────────────────────────────────

function Step4Dates({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 py-6 px-4 max-w-4xl mx-auto w-full">
      <div className="lg:col-span-3 space-y-4">
        <div>
          <h2 className="text-3xl font-bold uppercase" style={FONT}>
            Fechas y equipos
          </h2>
          <p className="text-black/60 text-sm mt-1">¿Cuándo y cuántos equipos?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Fecha de inicio *
            </label>
            <input
              type="date"
              value={state.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Fecha de fin *
            </label>
            <input
              type="date"
              value={state.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
            Cantidad de equipos *
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={4}
              max={64}
              step={2}
              value={state.teamsCount}
              onChange={(e) => onChange({ teamsCount: Number(e.target.value) })}
              className="flex-1 accent-spk-red"
            />
            <div
              className="w-16 h-10 flex items-center justify-center bg-spk-red text-white rounded-lg font-bold text-lg"
              style={FONT}
            >
              {state.teamsCount}
            </div>
          </div>
          <p className="text-xs text-black/40 mt-1">Mín. 4 — Máx. 64 equipos</p>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
            Jugadoras por equipo
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={state.playersPerTeam}
            onChange={(e) => onChange({ playersPerTeam: Number(e.target.value) })}
            className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
          />
        </div>
      </div>

      {/* Calendar preview */}
      <div className="lg:col-span-2">
        <div className="sticky top-4">
          <p className="text-xs font-bold uppercase text-black/40 mb-2" style={FONT}>
            Resumen de fechas
          </p>
          <div className="rounded-xl border-2 border-black/10 p-4 bg-white space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-spk-red/10 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-spk-red" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-black/40" style={FONT}>
                  Inicio
                </p>
                <p className="font-bold text-sm" style={FONT}>
                  {state.startDate
                    ? new Date(state.startDate + 'T00:00:00').toLocaleDateString('es-ES', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : 'Sin definir'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-black/5 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-black/40" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-black/40" style={FONT}>
                  Fin
                </p>
                <p className="font-bold text-sm" style={FONT}>
                  {state.endDate
                    ? new Date(state.endDate + 'T00:00:00').toLocaleDateString('es-ES', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : 'Sin definir'}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-black/5">
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-black/40" />
                <span className="text-sm font-bold" style={FONT}>
                  {state.teamsCount} equipos · {state.playersPerTeam} jugadoras/equipo
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5 — Canchas y horarios ─────────────────────────────────────────────

function Step5Courts({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const addCourt = () => {
    onChange({
      courts: [...state.courts, { name: `Cancha ${state.courts.length + 1}`, location: '' }],
    });
  };

  const removeCourt = (i: number) => {
    onChange({ courts: state.courts.filter((_, idx) => idx !== i) });
  };

  const updateCourt = (i: number, patch: Partial<(typeof state.courts)[0]>) => {
    const updated = state.courts.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ courts: updated });
  };

  const hasSecondaryPhase = state.secondaryPhase?.enabled;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 py-6 px-4 max-w-4xl mx-auto w-full">
      <div className="lg:col-span-3 space-y-4">
        <div>
          <h2 className="text-3xl font-bold uppercase" style={FONT}>
            Canchas y horarios
          </h2>
          <p className="text-black/60 text-sm mt-1">Dónde y cuándo se juega</p>
        </div>

        {/* Courts */}
        <div>
          <label className="block text-xs font-bold uppercase text-black/50 mb-2" style={FONT}>
            Canchas
          </label>
          <div className="space-y-2">
            {state.courts.map((court, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={court.name}
                  onChange={(e) => updateCourt(i, { name: e.target.value })}
                  placeholder="Nombre de la cancha"
                  className="flex-1 px-3 py-2 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
                />
                <input
                  type="text"
                  value={court.location}
                  onChange={(e) => updateCourt(i, { location: e.target.value })}
                  placeholder="Dirección (opcional)"
                  className="flex-1 px-3 py-2 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm hidden sm:block"
                />
                {state.courts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCourt(i)}
                    className="p-2 text-black/30 hover:text-spk-red transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCourt}
            className="mt-2 flex items-center gap-1.5 text-sm text-spk-red hover:text-spk-red-dark font-bold transition-colors"
            style={FONT}
          >
            <Plus className="w-4 h-4" /> Agregar cancha
          </button>
        </div>

        {/* Schedule */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Hora inicio por día
            </label>
            <input
              type="time"
              value={state.dailyStartTime}
              onChange={(e) => onChange({ dailyStartTime: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Hora fin por día
            </label>
            <input
              type="time"
              value={state.dailyEndTime}
              onChange={(e) => onChange({ dailyEndTime: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Duración de partidos (min)
            </label>
            <input
              type="number"
              min={15}
              max={240}
              value={state.matchDurationMinutes}
              onChange={(e) => onChange({ matchDurationMinutes: Number(e.target.value) })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
              Pausa entre partidos (min)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={state.matchBreakMinutes}
              onChange={(e) => onChange({ matchBreakMinutes: Number(e.target.value) })}
              className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="lg:col-span-2">
        <div className="sticky top-4">
          <p className="text-xs font-bold uppercase text-black/40 mb-2" style={FONT}>
            Estructura del día
          </p>
          <div className="rounded-xl border-2 border-black/10 p-4 bg-white space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-spk-red" />
              <span className="text-sm font-bold" style={FONT}>
                {state.dailyStartTime} — {state.dailyEndTime}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-spk-red" />
                <span className="text-xs text-black/60">
                  Partidos de {state.matchDurationMinutes} min con {state.matchBreakMinutes} min de pausa
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-black/20" />
                <span className="text-xs text-black/60">
                  {state.courts.length} cancha{state.courts.length !== 1 ? 's' : ''} en simultáneo
                </span>
              </div>
              {hasSecondaryPhase && (
                <>
                  <div className="mt-2 pt-2 border-t border-black/5">
                    <p className="text-xs font-bold text-black/50 uppercase mb-1" style={FONT}>
                      Fases del torneo
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-xs text-black/60">Fase de grupos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-xs text-black/60">Triangulares (Oro + Plata)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-spk-red" />
                    <span className="text-xs text-black/60">Semifinales y Final</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 6 — Categorías y reglamento ────────────────────────────────────────

function Step6Categories({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const [newCategory, setNewCategory] = useState('');

  const addCategory = (cat: string) => {
    if (!cat.trim() || state.categories.includes(cat.trim())) return;
    onChange({ categories: [...state.categories, cat.trim()] });
    setNewCategory('');
  };

  const removeCategory = (cat: string) => {
    onChange({ categories: state.categories.filter((c) => c !== cat) });
  };

  const toggle = (cat: string) =>
    state.categories.includes(cat) ? removeCategory(cat) : addCategory(cat);

  return (
    <div className="flex flex-col gap-6 py-6 px-4 max-w-2xl mx-auto w-full">
      <div>
        <h2 className="text-3xl font-bold uppercase" style={FONT}>
          Categorías y reglamento
        </h2>
        <p className="text-black/60 text-sm mt-1">Todo opcional — podés completarlo después</p>
      </div>

      {/* Categories — grouped by age base */}
      <div>
        <label className="block text-xs font-bold uppercase text-black/50 mb-3" style={FONT}>
          Categorías del sistema
        </label>

        {/* Ramas por edad */}
        <div className="space-y-2">
          {CATEGORY_BASES.map((base) => (
            <div key={base} className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase text-black/40 w-28 flex-shrink-0" style={FONT}>
                {base}
              </span>
              {GENDERS.map((g) => {
                const cat = `${base} ${g}`;
                const selected = state.categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggle(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-all ${
                      selected
                        ? 'border-spk-red bg-spk-red text-white'
                        : 'border-black/10 text-black/50 hover:border-spk-red/40'
                    }`}
                    style={FONT}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          ))}
          {/* Mixto */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase text-black/40 w-28 flex-shrink-0" style={FONT}>
              Mixto
            </span>
            {['Mixto'].map((cat) => {
              const selected = state.categories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggle(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-all ${
                    selected
                      ? 'border-spk-red bg-spk-red text-white'
                      : 'border-black/10 text-black/50 hover:border-spk-red/40'
                  }`}
                  style={FONT}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom category */}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory(newCategory)}
            placeholder="Otra categoría..."
            className="flex-1 px-4 py-2 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
          />
          <button
            type="button"
            onClick={() => addCategory(newCategory)}
            className="px-4 py-2 bg-spk-red text-white rounded-lg font-bold text-sm transition-colors hover:bg-spk-red-dark"
            style={FONT}
          >
            Agregar
          </button>
        </div>
        {state.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {state.categories.map((cat) => (
              <span
                key={cat}
                className="flex items-center gap-1.5 px-3 py-1 bg-spk-red/10 text-spk-red rounded-full text-xs font-bold"
                style={FONT}
              >
                {cat}
                <button type="button" onClick={() => removeCategory(cat)}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Enrollment deadline */}
      <div>
        <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
          Fecha límite de inscripción
        </label>
        <input
          type="date"
          value={state.enrollmentDeadline}
          onChange={(e) => onChange({ enrollmentDeadline: e.target.value })}
          className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm"
        />
      </div>

      {/* Regulation */}
      <div>
        <label className="block text-xs font-bold uppercase text-black/50 mb-1.5" style={FONT}>
          Reglamento
        </label>
        <textarea
          value={state.regulationText}
          onChange={(e) => onChange({ regulationText: e.target.value })}
          placeholder="Describí las reglas, condiciones y cualquier información importante para los participantes..."
          rows={5}
          className="w-full px-4 py-2.5 border-2 border-black/10 rounded-lg focus:outline-none focus:border-spk-red text-sm resize-none"
        />
      </div>
    </div>
  );
}

// ─── Step 7 — Resumen ────────────────────────────────────────────────────────

function Step7Summary({
  state,
  onSubmit,
  isSubmitting,
}: {
  state: WizardState;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const typeInfo = TOURNAMENT_TYPES.find((t) => t.id === state.tournamentTypeId);

  // Show the tournament type name when available, otherwise fall back to format label
  const formatLabel = typeInfo
    ? typeInfo.name
    : ({
        groups: 'Solo Grupos',
        knockout: 'Solo Eliminatoria',
        'groups+knockout': 'Grupos + Eliminatoria',
        league: 'Liga',
      }[state.format] ?? state.format);

  return (
    <div className="flex flex-col gap-6 py-6 px-4 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold uppercase" style={FONT}>
          Resumen del torneo
        </h2>
        <p className="text-black/60 text-sm mt-1">Revisá todo antes de crear</p>
      </div>

      <div className="rounded-xl border-2 border-black/10 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="h-32 bg-gradient-to-br from-[#003087] to-spk-red flex flex-col items-center justify-center relative gap-2">
          <Trophy className="w-10 h-10 text-white/40" />
          {typeInfo && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full">
              <typeInfo.Icon className={`w-4 h-4 ${typeInfo.iconColor} bg-white/90 rounded-full p-0.5`} />
              <span className="text-white text-sm font-bold" style={FONT}>{typeInfo.name}</span>
            </div>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Name + sport */}
          <div>
            <h3 className="text-2xl font-bold uppercase" style={FONT}>
              {state.name || '(sin nombre)'}
            </h3>
            <p className="text-black/60 text-sm">{state.club}</p>
            {state.city && (
              <p className="text-xs text-black/50 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" /> {state.city}
              </p>
            )}
          </div>

          {/* Grid stats */}
          <div className="grid grid-cols-2 gap-3">
            <SummaryItem icon={<Calendar className="w-4 h-4 text-spk-red" />} label="Fechas">
              {state.startDate && state.endDate
                ? `${state.startDate} → ${state.endDate}`
                : 'Sin definir'}
            </SummaryItem>
            <SummaryItem icon={<Users className="w-4 h-4 text-spk-red" />} label="Equipos">
              {state.teamsCount} equipos · {state.playersPerTeam} jug/equipo
            </SummaryItem>
            <SummaryItem icon={<Trophy className="w-4 h-4 text-spk-red" />} label="Formato">
              {formatLabel}
            </SummaryItem>
            <SummaryItem icon={<MapPin className="w-4 h-4 text-spk-red" />} label="Canchas">
              {state.courts.length} cancha{state.courts.length !== 1 ? 's' : ''} ·{' '}
              {state.courts.map((c) => c.name).join(', ')}
            </SummaryItem>
            <SummaryItem icon={<Clock className="w-4 h-4 text-spk-red" />} label="Horarios">
              {state.dailyStartTime}–{state.dailyEndTime} · {state.matchDurationMinutes}min/partido
            </SummaryItem>
            {state.categories.length > 0 && (
              <SummaryItem icon={<CheckCircle2 className="w-4 h-4 text-spk-red" />} label="Categorías">
                {state.categories.join(', ')}
              </SummaryItem>
            )}
            {state.bracketMode === 'divisions' && (
              <SummaryItem icon={<Award className="w-4 h-4 text-yellow-600" />} label="Divisiones">
                Copa Oro ({state.goldClassifiersPerGroup}/grupo) · Copa Plata ({state.silverClassifiersPerGroup}/grupo)
              </SummaryItem>
            )}
          </div>

          {/* Secondary phase banner */}
          {state.secondaryPhase?.enabled && (
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800" style={FONT}>
              <Award className="w-4 h-4 text-yellow-600 flex-shrink-0" />
              {(state.secondaryPhase.seedingMode ?? 'balanced') === 'balanced' ? (
                <>
                  <span className="font-bold uppercase tracking-wide">Segunda fase de grupos</span>
                  <span className="text-yellow-600">
                    · pools balanceados de {state.secondaryPhase.teamsPerGroup} equipos (1° a {state.secondaryPhase.teamsPerGroup}° mezclados de grupos distintos)
                  </span>
                </>
              ) : (
                <>
                  <span className="font-bold uppercase tracking-wide">Triangulares Oro / Plata</span>
                  <span className="text-yellow-600">
                    · {state.secondaryPhase.groupsPerDivision} grupos de {state.secondaryPhase.teamsPerGroup} equipos por copa · Clasifica 1 por grupo
                  </span>
                </>
              )}
            </div>
          )}

          {state.description && (
            <p className="text-sm text-black/60 border-t border-black/5 pt-3">{state.description}</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-spk-red hover:bg-spk-red-dark text-white font-bold rounded-xl text-lg transition-colors disabled:opacity-60 shadow-lg shadow-spk-red/20"
        style={FONT}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Creando torneo...
          </>
        ) : (
          <>
            <Trophy className="w-5 h-5" />
            CREAR TORNEO
          </>
        )}
      </button>
    </div>
  );
}

function SummaryItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-[10px] uppercase font-bold text-black/40" style={FONT}>
          {label}
        </p>
        <p className="text-xs text-black/70">{children}</p>
      </div>
    </div>
  );
}

// ─── Main Wizard ─────────────────────────────────────────────────────────────

export function CreateTournamentWizard() {
  const navigate = useNavigate();
  const { addTournament } = useData();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // Build a TournamentFormState-compatible object for TournamentAssistant
  const aiFormState: TournamentFormState = {
    name: state.name,
    club: state.club,
    sport: state.sport,
    description: state.description,
    startDate: state.startDate,
    endDate: state.endDate,
    status: 'upcoming',
    teamsCount: state.teamsCount,
    format: state.format,
    courts: state.courts,
    categories: state.categories,
    enrollmentDeadline: state.enrollmentDeadline,
    registrationOpensAt: '',
    registrationClosesAt: '',
    playersPerTeam: state.playersPerTeam,
    bracketMode: state.bracketMode,
    goldClassifiersPerGroup: state.goldClassifiersPerGroup,
    silverClassifiersPerGroup: state.silverClassifiersPerGroup,
    regulationText: state.regulationText,
    regulationPdfUrl: '',
    matchBreakMinutes: state.matchBreakMinutes,
    dailySchedules: [],
    maxMatchesPerDay: 0,
    deadTimeBlocks: [],
    categoryPriority: [],
    finalsCourt: '',
    matchDurationsByCategory: {},
    city: state.city,
    secondaryPhase: state.secondaryPhase,
  };

  const handleAiApply = useCallback(
    (patch: Partial<TournamentFormState>) => {
      const wizardPatch: Partial<WizardState> = {};
      if (patch.name !== undefined) wizardPatch.name = patch.name;
      if (patch.club !== undefined) wizardPatch.club = patch.club;
      if (patch.sport !== undefined) wizardPatch.sport = patch.sport;
      if (patch.description !== undefined) wizardPatch.description = patch.description;
      if (patch.startDate !== undefined) wizardPatch.startDate = patch.startDate;
      if (patch.endDate !== undefined) wizardPatch.endDate = patch.endDate;
      if (patch.teamsCount !== undefined) wizardPatch.teamsCount = patch.teamsCount;
      if (patch.format !== undefined) wizardPatch.format = patch.format;
      if (patch.courts !== undefined) wizardPatch.courts = patch.courts;
      if (patch.categories !== undefined) wizardPatch.categories = patch.categories;
      if (patch.enrollmentDeadline !== undefined)
        wizardPatch.enrollmentDeadline = patch.enrollmentDeadline;
      if (patch.playersPerTeam !== undefined) wizardPatch.playersPerTeam = patch.playersPerTeam;
      if (patch.bracketMode !== undefined) wizardPatch.bracketMode = patch.bracketMode;
      if (patch.goldClassifiersPerGroup !== undefined)
        wizardPatch.goldClassifiersPerGroup = patch.goldClassifiersPerGroup;
      if (patch.silverClassifiersPerGroup !== undefined)
        wizardPatch.silverClassifiersPerGroup = patch.silverClassifiersPerGroup;
      if (patch.matchBreakMinutes !== undefined)
        wizardPatch.matchBreakMinutes = patch.matchBreakMinutes;
      if (patch.regulationText !== undefined) wizardPatch.regulationText = patch.regulationText;
      if (patch.city !== undefined) wizardPatch.city = patch.city;
      update(wizardPatch);
      setAiApplied(true);
    },
    [update],
  );

  const handleTypeSelect = (id: string) => {
    const type = TOURNAMENT_TYPES.find((t) => t.id === id);
    if (!type) return;
    const preset = type.preset as Partial<WizardState>;
    update({
      tournamentTypeId: id,
      ...preset,
    });
  };

  // Step navigation
  // Manual flow: 0=Método, 1=Deporte, 2=Tipo, 3=Info, 4=Fechas, 5=Canchas, 6=Cat., 7=Resumen
  // AI flow:     0=Método, 1=IA Chat, 2=Info, 3=Fechas, 4=Canchas, 5=Cat., 6=Resumen
  const isAiFlow = state.creationMethod === 'ai';

  const totalSteps = isAiFlow ? 7 : 8;

  const canAdvance = (): boolean => {
    if (isAiFlow) {
      if (step === 0) return state.creationMethod !== null;
      if (step === 1) return aiApplied;
      if (step === 2) return state.name.trim() !== '' && state.club.trim() !== '';
      if (step === 3) return state.startDate !== '' && state.endDate !== '' && state.teamsCount >= 4;
      if (step === 4) return state.courts.length > 0 && state.courts[0].name.trim() !== '';
      return true;
    }
    // Manual flow
    if (step === 0) return state.creationMethod !== null;
    if (step === 1) return state.sport !== '';
    if (step === 2) return state.tournamentTypeId !== null;
    if (step === 3) return state.name.trim() !== '' && state.club.trim() !== '';
    if (step === 4) return state.startDate !== '' && state.endDate !== '' && state.teamsCount >= 4;
    if (step === 5) return state.courts.length > 0 && state.courts[0].name.trim() !== '';
    return true;
  };

  const next = () => {
    if (!canAdvance()) {
      const manualMsgs: Record<number, string> = {
        0: 'Seleccioná un método de creación',
        1: 'Seleccioná el deporte del torneo',
        2: 'Seleccioná un tipo de torneo',
        3: 'Completá el nombre y el club del torneo',
        4: 'Completá las fechas y la cantidad de equipos',
        5: 'Agregá al menos una cancha',
      };
      const aiMsgs: Record<number, string> = {
        0: 'Seleccioná un método de creación',
        1: 'Aplicá las sugerencias de la IA primero',
        2: 'Completá el nombre y el club del torneo',
        3: 'Completá las fechas y la cantidad de equipos',
        4: 'Agregá al menos una cancha',
      };
      const msgs = isAiFlow ? aiMsgs : manualMsgs;
      toast.error(msgs[step] ?? 'Completá los campos requeridos');
      return;
    }
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!state.name.trim() || !state.club.trim()) {
      toast.error('Completá el nombre y el club del torneo');
      return;
    }
    if (!state.startDate || !state.endDate) {
      toast.error('Completá las fechas del torneo');
      return;
    }

    setIsSubmitting(true);
    try {
      // Build dailySchedules from global start/end times across the date range
      const dailySchedules: Record<string, { start: string; end: string }> = {};
      if (state.startDate && state.endDate) {
        // Use noon to avoid timezone shifting the date
        const start = new Date(state.startDate + 'T12:00:00');
        const end   = new Date(state.endDate   + 'T12:00:00');
        for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().split('T')[0];
          dailySchedules[key] = { start: state.dailyStartTime, end: state.dailyEndTime };
        }
      }

      const validCourts = state.courts
        .map((c) => ({ name: c.name.trim(), location: c.location.trim() }))
        .filter((c) => c.name !== '');

      const dto: CreateTournamentDto = {
        name: state.name.trim(),
        sport: state.sport || 'Voleibol',
        club: state.club.trim(),
        // Send as ISO date strings — backend accepts both Date objects and strings
        startDate: state.startDate,
        endDate: state.endDate,
        description: state.description.trim() || 'Torneo organizado en Torny',
        status: 'upcoming',
        teamsCount: state.teamsCount,
        format: state.format,
        courts: validCourts.map((c) => c.name),
        courtLocations: validCourts.reduce(
          (acc, c) => { if (c.location) acc[c.name] = c.location; return acc; },
          {} as Record<string, string>,
        ),
        categories: state.categories.length > 0 ? state.categories : undefined,
        enrollmentDeadline: state.enrollmentDeadline || undefined,
        playersPerTeam: state.playersPerTeam,
        bracketMode: state.bracketMode,
        goldClassifiersPerGroup: state.goldClassifiersPerGroup,
        silverClassifiersPerGroup: state.silverClassifiersPerGroup,
        regulationText: state.regulationText || undefined,
        matchDurationMinutes: state.matchDurationMinutes,
        matchBreakMinutes: state.matchBreakMinutes,
        dailySchedules,
        maxMatchesPerDay: 0,
        deadTimeBlocks: [],
        categoryPriority: state.categories.length > 0 ? state.categories : [],
        city: state.city.trim() || undefined,
        secondaryPhase: state.secondaryPhase ?? undefined,
      };

      const newTournament = await addTournament(dto);
      toast.success(`¡Torneo "${newTournament.name}" creado correctamente!`);
      navigate(`/admin/tournaments/${newTournament.id}`);
    } catch (err) {
      console.error('[CreateTournamentWizard] submit error:', err);
      const msg = err instanceof Error ? err.message : 'Error al crear el torneo. Verificá los campos.';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute which summary step index is (last step)
  const summaryStep = totalSteps - 1;

  // Step that has "Ver resumen" label instead of "Siguiente" (second to last)
  const previewStep = totalSteps - 2;

  const stepContent = () => {
    if (isAiFlow) {
      // AI flow: 0=Método, 1=IA, 2=Info, 3=Fechas, 4=Canchas, 5=Cat., 6=Resumen
      switch (step) {
        case 0: return <Step1Method value={state.creationMethod} onChange={(v) => update({ creationMethod: v })} />;
        case 1: return <Step2AI formState={aiFormState} onApply={handleAiApply} onContinue={next} hasSuggestions={aiApplied} />;
        case 2: return <Step3Info state={state} onChange={update} hideSport />;
        case 3: return <Step4Dates state={state} onChange={update} />;
        case 4: return <Step5Courts state={state} onChange={update} />;
        case 5: return <Step6Categories state={state} onChange={update} />;
        case 6: return <Step7Summary state={state} onSubmit={handleSubmit} isSubmitting={isSubmitting} />;
        default: return null;
      }
    }
    // Manual flow: 0=Método, 1=Deporte, 2=Tipo, 3=Info, 4=Fechas, 5=Canchas, 6=Cat., 7=Resumen
    switch (step) {
      case 0: return <Step1Method value={state.creationMethod} onChange={(v) => update({ creationMethod: v })} />;
      case 1: return <StepSport value={state.sport} onChange={(v) => update({ sport: v })} />;
      case 2: return <Step2Type value={state.tournamentTypeId} onChange={handleTypeSelect} />;
      case 3: return <Step3Info state={state} onChange={update} hideSport />;
      case 4: return <Step4Dates state={state} onChange={update} />;
      case 5: return <Step5Courts state={state} onChange={update} />;
      case 6: return <Step6Categories state={state} onChange={update} />;
      case 7: return <Step7Summary state={state} onSubmit={handleSubmit} isSubmitting={isSubmitting} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b-2 border-black/5 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={() => (step === 0 ? navigate('/admin/tournaments') : back())}
          className="flex items-center gap-1.5 text-sm font-bold text-black/60 hover:text-black transition-colors"
          style={FONT}
        >
          <ChevronLeft className="w-4 h-4" />
          {step === 0 ? 'Volver' : 'Anterior'}
        </button>

        <h1
          className="text-lg font-bold uppercase tracking-wider"
          style={FONT}
        >
          CREAR TORNEO
        </h1>

        <div className="flex items-center gap-1">
          <Trophy className="w-5 h-5 text-spk-red" />
          <span className="text-sm font-bold" style={FONT}>
            Torny
          </span>
        </div>
      </header>

      {/* Progress */}
      <div className="border-b border-black/5 bg-white">
        <StepIndicator current={step} total={totalSteps} />
      </div>

      {/* Main content — scrollable area */}
      <main className="flex-1 overflow-y-auto">
        <div className="min-h-full">{stepContent()}</div>
      </main>

      {/* Footer navigation — hidden on summary (submit is inline) and AI chat step */}
      {step !== summaryStep && !(isAiFlow && step === 1) && (
        <footer className="border-t-2 border-black/5 bg-white px-4 py-3 flex items-center justify-between sticky bottom-0 z-10">
          <button
            type="button"
            onClick={() => (step === 0 ? navigate('/admin/tournaments') : back())}
            className="flex items-center gap-1.5 px-5 py-2.5 border-2 border-black/10 rounded-lg text-sm font-bold text-black/60 hover:border-black/30 hover:text-black transition-all"
            style={FONT}
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Cancelar' : 'Anterior'}
          </button>

          <div className="text-xs text-black/30 font-bold" style={FONT}>
            {step + 1} / {totalSteps}
          </div>

          <button
            type="button"
            onClick={next}
            disabled={!canAdvance()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-spk-red hover:bg-spk-red-dark disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition-all"
            style={FONT}
          >
            {step === previewStep ? 'Ver resumen' : 'Siguiente'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </footer>
      )}

      {/* Special footer for AI step */}
      {isAiFlow && step === 1 && (
        <footer className="border-t-2 border-black/5 bg-white px-4 py-3 flex items-center justify-between sticky bottom-0 z-10">
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1.5 px-5 py-2.5 border-2 border-black/10 rounded-lg text-sm font-bold text-black/60 hover:border-black/30 hover:text-black transition-all"
            style={FONT}
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </button>
          <div className="text-xs text-black/30 font-bold" style={FONT}>
            {step + 1} / {totalSteps}
          </div>
          <div />
        </footer>
      )}
    </div>
  );
}
