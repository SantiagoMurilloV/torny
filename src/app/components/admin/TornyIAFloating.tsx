import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, ArrowUp, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext';

// Pages where the floating button should NOT appear
// (wizard has its own AI step, so the button would conflict with footer nav)
const HIDDEN_ON_PATHS = ['/admin/tournaments/new'];
import { sendAgentChat, type ChatMessage, type ActionLog } from '../../services/api/ai';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionLog[];
}

const QUICK_REPLIES = [
  '¿Cómo van mis torneos?',
  '¿Cómo inscribo equipos?',
  '¿Cómo genero grupos?',
];

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({ actions }: { actions: ActionLog[] }) {
  if (!actions.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {actions.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
            a.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}
        >
          {a.success ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
          )}
          <span className={a.success ? 'text-green-800' : 'text-red-700'}>{a.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Loading dots ──────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 bg-black/30 rounded-full"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TornyIAFloating() {
  const location = useLocation();
  const { user } = useAuth();

  // Don't render on pages that have their own AI interface
  if (HIDDEN_ON_PATHS.some((p) => location.pathname.startsWith(p))) return null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-send welcome on first open — small delay to ensure auth token is loaded
  useEffect(() => {
    if (open && !hasOpened && user?.username) {
      setHasOpened(true);
      // Small delay so the panel animation finishes and auth is fully ready
      const t = setTimeout(() => {
        void sendMessage(`Hola, soy ${user.username}. ¿En qué estado están mis torneos?`);
      }, 400);
      return () => clearTimeout(t);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.username]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed };
      const updatedMsgs = [...messages, userMsg];
      setMessages(updatedMsgs);
      setInput('');
      setLoading(true);

      try {
        const history: ChatMessage[] = updatedMsgs.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const result = await sendAgentChat(history, location.pathname);

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: result.message,
            actions: result.actionsExecuted && result.actionsExecuted.length > 0
              ? result.actionsExecuted
              : undefined,
          },
        ]);
        setTimeout(scrollToBottom, 80);
      } catch (err) {
        console.error('[TornyIA] sendAgentChat error:', err);
        // Show the actual error message if available
        const errMsg = err instanceof Error
          ? err.message
          : (typeof err === 'object' && err !== null && 'message' in err)
            ? String((err as { message: unknown }).message)
            : null;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: errMsg && errMsg.length < 200
              ? `Tuve un inconveniente: ${errMsg}. Por favor intente de nuevo.`
              : 'Tuve un inconveniente al procesar su solicitud. Por favor intente de nuevo.',
          },
        ]);
        setTimeout(scrollToBottom, 80);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, location.pathname, scrollToBottom],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => { e.preventDefault(); void sendMessage(input); },
    [input, sendMessage],
  );

  return (
    <>
      {/* ── Floating button ─────────────────────────────────────────── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.07 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-black text-white pl-4 pr-5 py-3 rounded-full shadow-2xl"
          >
            <div className="relative">
              <Sparkles className="w-5 h-5" />
              {/* Pulsing red dot */}
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-spk-red rounded-full">
                <motion.span
                  className="absolute inset-0 rounded-full bg-spk-red"
                  animate={{ scale: [1, 2.2], opacity: [0.8, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              </span>
            </div>
            <span className="font-bold text-sm tracking-wide" style={FONT}>
              Torny IA
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Panel ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Mobile overlay */}
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 sm:hidden"
              onClick={() => setOpen(false)}
            />

            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ x: 440 }}
              animate={{ x: 0 }}
              exit={{ x: 440 }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed right-0 top-0 h-full w-full sm:w-[420px] z-50 flex flex-col bg-white shadow-2xl border-l border-black/10"
            >
              {/* Header */}
              <div className="bg-black px-5 py-4 flex items-center gap-3 flex-shrink-0">
                <div className="relative">
                  <div className="w-9 h-9 bg-spk-red rounded-full flex items-center justify-center">
                    <Sparkles className="w-4.5 h-4.5 text-white" />
                  </div>
                  <motion.span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-black"
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-white font-black text-lg leading-none" style={FONT}>
                    Torny <span className="text-spk-red">IA</span>
                  </p>
                  <p className="text-white/50 text-xs mt-0.5">
                    Asistente personal · {user?.username ?? 'Admin'}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 text-white/50 hover:text-white transition-colors rounded-full hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center h-full gap-5 py-10">
                    <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-lg" style={FONT}>Torny IA</p>
                      <p className="text-black/50 text-sm mt-1 max-w-xs">
                        Con mucho gusto le ayudo con sus torneos. ¿En qué puedo asistirle?
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 w-full">
                      {QUICK_REPLIES.map((qr) => (
                        <button
                          key={qr}
                          onClick={() => void sendMessage(qr)}
                          className="px-4 py-2.5 rounded-xl border-2 border-black/10 hover:border-black/30 text-sm text-left text-black/70 hover:text-black transition-all"
                        >
                          {qr}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                      <div
                        className={`px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                          msg.role === 'user'
                            ? 'bg-black text-white rounded-2xl rounded-tr-sm'
                            : 'bg-black/[0.06] text-black/85 rounded-2xl rounded-tl-sm'
                        }`}
                      >
                        {msg.content}
                      </div>
                      {/* Actions executed */}
                      {msg.actions && msg.actions.length > 0 && (
                        <div className="w-full">
                          <div className="flex items-center gap-1.5 mb-1.5 px-1">
                            <Zap className="w-3 h-3 text-spk-red" />
                            <span className="text-[11px] text-black/50 font-bold uppercase tracking-wide" style={FONT}>
                              Acciones ejecutadas
                            </span>
                          </div>
                          <ActionCard actions={msg.actions} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-black/[0.06] rounded-2xl rounded-tl-sm">
                      <LoadingDots />
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-4 pb-4 pt-3 border-t border-black/8 flex-shrink-0">
                <form onSubmit={handleSubmit} className="flex gap-2 items-center">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pregúnteme o pídame una acción..."
                    disabled={loading}
                    className="flex-1 px-4 py-3 text-sm bg-black/[0.04] border border-black/10 rounded-full focus:outline-none focus:border-black disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center hover:bg-black/80 disabled:opacity-30 transition-colors flex-shrink-0"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                </form>
                <p className="text-center text-[10px] text-black/30 mt-2">
                  Torny IA puede ejecutar acciones en tu plataforma
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
