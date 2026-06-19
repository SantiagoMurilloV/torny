import { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, Send, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { sendAIChat, type ChatMessage, type TournamentSuggestions, type AIChatResponse } from '../../services/api/ai';
import type { TournamentFormState, CourtEntry } from './tournament-form/types';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface TournamentAssistantProps {
  onApplySuggestions: (patch: Partial<TournamentFormState>) => void;
  formState: TournamentFormState;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  response?: AIChatResponse;
  applied?: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  groups: 'Solo Grupos',
  knockout: 'Solo Eliminatoria',
  'groups+knockout': 'Grupos + Eliminatoria',
  league: 'Liga',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  club: 'Club',
  sport: 'Deporte',
  description: 'Descripción',
  startDate: 'Fecha inicio',
  endDate: 'Fecha fin',
  teamsCount: 'Equipos',
  format: 'Formato',
  courts: 'Canchas',
  categories: 'Categorías',
  city: 'Ciudad',
  matchBreakMinutes: 'Pausa entre partidos',
  playersPerTeam: 'Jugadores/equipo',
  regulationText: 'Reglamento',
  matchDurationMinutes: 'Duración partidos',
  maxMatchesPerDay: 'Máx. partidos/día',
  enrollmentDeadline: 'Límite de inscripción',
  bracketMode: 'Tipo de cruce',
  goldClassifiersPerGroup: 'Clasificados a Oro',
  silverClassifiersPerGroup: 'Clasificados a Plata',
};

// ── Suggestion → FormState patch ──────────────────────────────────────────────

function buildSuggestionPatch(suggestions: TournamentSuggestions): Partial<TournamentFormState> {
  const patch: Partial<TournamentFormState> = {};

  if (suggestions.name        !== undefined) patch.name        = suggestions.name;
  if (suggestions.club        !== undefined) patch.club        = suggestions.club;
  if (suggestions.sport       !== undefined) patch.sport       = suggestions.sport;
  if (suggestions.description !== undefined) patch.description = suggestions.description;
  if (suggestions.startDate   !== undefined) patch.startDate   = suggestions.startDate;
  if (suggestions.endDate     !== undefined) patch.endDate     = suggestions.endDate;
  if (suggestions.teamsCount  !== undefined) patch.teamsCount  = suggestions.teamsCount;
  if (suggestions.format      !== undefined) patch.format      = suggestions.format;
  if (suggestions.status      !== undefined) patch.status      = suggestions.status;
  if (suggestions.categories  !== undefined) patch.categories  = suggestions.categories;
  if (suggestions.city        !== undefined) patch.city        = suggestions.city;
  if (suggestions.matchBreakMinutes       !== undefined) patch.matchBreakMinutes       = suggestions.matchBreakMinutes;
  if (suggestions.playersPerTeam          !== undefined) patch.playersPerTeam          = suggestions.playersPerTeam;
  if (suggestions.bracketMode             !== undefined) patch.bracketMode             = suggestions.bracketMode;
  if (suggestions.goldClassifiersPerGroup !== undefined) patch.goldClassifiersPerGroup = suggestions.goldClassifiersPerGroup;
  if (suggestions.silverClassifiersPerGroup !== undefined) patch.silverClassifiersPerGroup = suggestions.silverClassifiersPerGroup;
  if (suggestions.maxMatchesPerDay        !== undefined) patch.maxMatchesPerDay        = suggestions.maxMatchesPerDay;
  if (suggestions.regulationText          !== undefined) patch.regulationText          = suggestions.regulationText;
  if (suggestions.enrollmentDeadline      !== undefined) patch.enrollmentDeadline      = suggestions.enrollmentDeadline;

  if (suggestions.matchDurationMinutes !== undefined) {
    const mins = suggestions.matchDurationMinutes;
    const cats = suggestions.categories ?? [];
    if (cats.length > 0) {
      const byCategory: Record<string, number> = {};
      for (const cat of cats) byCategory[cat] = mins;
      patch.matchDurationsByCategory = byCategory;
    }
  }

  if (suggestions.courts !== undefined) {
    patch.courts = suggestions.courts.map((name): CourtEntry => ({ name, location: '' }));
  }

  return patch;
}

// ── Field value formatter ─────────────────────────────────────────────────────

function formatFieldValue(key: string, value: unknown): string {
  if (key === 'format' && typeof value === 'string') return FORMAT_LABELS[value] ?? value;
  if (key === 'courts' && Array.isArray(value)) return (value as string[]).join(', ');
  if (key === 'categories' && Array.isArray(value)) return (value as string[]).join(', ');
  if ((key === 'matchBreakMinutes' || key === 'matchDurationMinutes') && typeof value === 'number') return `${value} min`;
  if (key === 'regulationText' && typeof value === 'string') return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  return String(value);
}

// ── Suggestion card ───────────────────────────────────────────────────────────

function SuggestionCard({
  suggestions,
  onApply,
  applied,
  isComplete,
}: {
  suggestions: TournamentSuggestions;
  onApply: () => void;
  applied: boolean;
  isComplete?: boolean;
}) {
  const entries = Object.entries(suggestions).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  ) as [string, unknown][];

  if (entries.length === 0) return null;

  return (
    <div className={`mt-2 rounded-sm border p-3 text-sm ${isComplete ? 'border-green-400/40 bg-green-50' : 'border-spk-red/20 bg-spk-red/5'}`}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isComplete ? 'text-green-700' : 'text-spk-red/70'}`} style={FONT}>
        {isComplete ? '✓ Torneo completo — campos listos' : 'Campos sugeridos'}
      </p>
      <ul className="space-y-0.5 mb-3 max-h-40 overflow-y-auto">
        {entries.map(([key, value]) => {
          const label = FIELD_LABELS[key];
          if (!label) return null;
          return (
            <li key={key} className="flex gap-2 text-xs text-black/70">
              <span className="font-bold text-black/50 shrink-0 min-w-[100px]" style={FONT}>{label}:</span>
              <span className="text-black/80 break-all">{formatFieldValue(key, value)}</span>
            </li>
          );
        })}
      </ul>
      <button
        onClick={onApply}
        disabled={applied}
        className={`w-full py-1.5 px-3 rounded-sm text-xs font-bold transition-colors ${
          applied
            ? 'bg-green-100 text-green-700 cursor-default'
            : isComplete
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-spk-red text-white hover:bg-spk-red-dark'
        }`}
        style={FONT}
      >
        {applied ? '✓ Aplicado al formulario' : isComplete ? '🏆 Aplicar todo al formulario' : 'Aplicar al formulario'}
      </button>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['name', 'sport', 'club', 'description', 'startDate', 'endDate', 'teamsCount', 'format', 'courts'] as const;
const OPTIONAL_FIELDS = ['city', 'categories', 'matchBreakMinutes', 'playersPerTeam', 'regulationText'] as const;

function calcProgress(formState: TournamentFormState): { filled: number; total: number; pct: number } {
  const isDefault = (key: string, val: unknown) =>
    (key === 'teamsCount' && val === 8) ||
    (key === 'matchBreakMinutes' && val === 15) ||
    (key === 'playersPerTeam' && val === 12) ||
    (key === 'sport' && val === 'Voleibol') ||
    (key === 'format' && val === 'groups+knockout');

  const isEmpty = (key: string, val: unknown) =>
    val === undefined || val === null || val === '' ||
    (Array.isArray(val) && val.length === 0) ||
    isDefault(key, val);

  const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as string[];
  let filled = 0;
  for (const f of allFields) {
    const val = (formState as unknown as Record<string, unknown>)[f];
    if (!isEmpty(f, val)) filled++;
  }
  return { filled, total: allFields.length, pct: Math.round((filled / allFields.length) * 100) };
}

// ── Main component ────────────────────────────────────────────────────────────

export function TournamentAssistant({ onApplySuggestions, formState }: TournamentAssistantProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Serialize formState for the API (strip File objects and complex refs)
  const getFormStateForApi = (): Record<string, unknown> => {
    const s = formState as unknown as Record<string, unknown>;
    return {
      name: s.name, sport: s.sport, club: s.club, description: s.description,
      startDate: s.startDate, endDate: s.endDate, teamsCount: s.teamsCount,
      format: s.format, status: s.status, city: s.city,
      courts: Array.isArray(s.courts) ? (s.courts as CourtEntry[]).map((c) => c.name) : [],
      categories: s.categories, matchBreakMinutes: s.matchBreakMinutes,
      playersPerTeam: s.playersPerTeam, maxMatchesPerDay: s.maxMatchesPerDay,
      bracketMode: s.bracketMode, regulationText: s.regulationText,
      enrollmentDeadline: s.enrollmentDeadline,
      goldClassifiersPerGroup: s.goldClassifiersPerGroup,
      silverClassifiersPerGroup: s.silverClassifiersPerGroup,
    };
  };

  // Scroll only when AI responds (loading → false)
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;
    if (wasLoading && !loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading]);

  // Send greeting on first open
  useEffect(() => {
    if (isOpen && !initialized) {
      setInitialized(true);
      void sendGreeting();
    }
  }, [isOpen, initialized]);

  async function sendGreeting() {
    const greetingMessage: ChatMessage = { role: 'user', content: 'Hola, quiero crear un nuevo torneo' };
    setMessages([{ role: 'user', content: greetingMessage.content }]);
    setLoading(true);
    try {
      const response = await sendAIChat([greetingMessage], getFormStateForApi());
      setMessages([
        { role: 'user', content: greetingMessage.content },
        { role: 'assistant', content: response.message, response },
      ]);
    } catch {
      setMessages([
        { role: 'user', content: greetingMessage.content },
        { role: 'assistant', content: 'Hubo un problema al conectar con el asistente. Intentá de nuevo.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const newUserMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setLoading(true);
    const apiMessages: ChatMessage[] = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
    try {
      const response = await sendAIChat(apiMessages, getFormStateForApi());
      setMessages([...updatedMessages, { role: 'assistant', content: response.message, response }]);
    } catch {
      setMessages([...updatedMessages, { role: 'assistant', content: 'Algo salió mal. ¿Podés intentar de nuevo?' }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  }

  function handleApply(index: number) {
    const msg = messages[index];
    if (!msg?.response?.suggestions) return;
    onApplySuggestions(buildSuggestionPatch(msg.response.suggestions));
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, applied: true } : m)));
  }

  const progress = calcProgress(formState);

  return (
    <div className="rounded-sm border border-black/10 bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-black/[0.03] hover:bg-black/[0.06] transition-colors text-left"
        style={FONT}
      >
        <Sparkles className="w-4 h-4 text-spk-red shrink-0" />
        <span className="font-bold text-sm uppercase tracking-wider text-black/80 flex-1">Asistente IA</span>

        {/* Progress pill */}
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full mr-1 ${
          progress.pct === 100 ? 'bg-green-100 text-green-700' : 'bg-spk-red/10 text-spk-red'
        }`} style={FONT}>
          {progress.filled}/{progress.total} campos
        </span>

        {isOpen ? <ChevronUp className="w-4 h-4 text-black/40" /> : <ChevronDown className="w-4 h-4 text-black/40" />}
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-black/5">
        <div
          className={`h-full transition-all duration-500 ${progress.pct === 100 ? 'bg-green-500' : 'bg-spk-red'}`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      {isOpen && (
        <div className="flex flex-col">
          {/* Chat thread */}
          <div className="px-3 py-3 space-y-3 min-h-[120px] max-h-[420px] overflow-y-auto">
            {messages.length === 0 && !loading && (
              <p className="text-sm text-black/40 text-center py-6" style={FONT}>
                Contame sobre tu torneo y lo armamos juntos, campo por campo.
              </p>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-sm px-3 py-2 text-sm ${
                  msg.role === 'user' ? 'bg-spk-red text-white' : 'bg-black/5 text-black/80'
                }`}>
                  <p className="whitespace-pre-wrap leading-snug">{msg.content}</p>

                  {msg.role === 'assistant' && msg.response?.suggestions &&
                    Object.keys(msg.response.suggestions).length > 0 && (
                      <SuggestionCard
                        suggestions={msg.response.suggestions}
                        onApply={() => handleApply(i)}
                        applied={msg.applied ?? false}
                        isComplete={msg.response.isComplete}
                      />
                    )}

                  {msg.role === 'assistant' && msg.response?.isComplete && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-green-700 font-bold" style={FONT}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Formulario 100% completo
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.response?.pendingFields && msg.response.pendingFields.length > 0 && !msg.response.isComplete && (
                    <p className="mt-1.5 text-[11px] text-black/40 italic">
                      Falta: {msg.response.pendingFields.slice(0, 5).join(', ')}{msg.response.pendingFields.length > 5 ? '…' : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-black/5 rounded-sm px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-black/40" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 pb-3 flex gap-2 border-t border-black/5 pt-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Respondé la pregunta del asistente..."
              disabled={loading}
              className="flex-1 px-3 py-2 text-sm border border-black/15 rounded-sm focus:outline-none focus:border-spk-red disabled:opacity-50 disabled:bg-black/5"
              style={FONT}
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="px-3 py-2 bg-spk-red text-white rounded-sm hover:bg-spk-red-dark transition-colors disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
