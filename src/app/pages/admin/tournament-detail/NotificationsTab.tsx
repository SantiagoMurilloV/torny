import { useState } from 'react';
import { Bell, Building2, Globe, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../services/api';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { getErrorMessage } from '../../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

type Audience = 'all' | 'clubs';

/**
 * "Notificaciones" tab — admin can compose a push notification and
 * pick the audience:
 *
 *   · 'all'   → `sendToAll` — every active subscription (public
 *               spectators + club captains). Use for general
 *               announcements that everyone watching the event
 *               should see (cancelaciones, clima, recordatorios).
 *
 *   · 'clubs' → `sendToClub` looped over every enrolled club's
 *               captain. Use for messages specific to teams (cita
 *               de acreditación, cambio de horario, recordatorios
 *               de calentamiento).
 *
 * Sending is gated by a confirm dialog so the admin can't fire by
 * accident — once it leaves, every device that's subscribed sees a
 * banner regardless of whether they're inside the app.
 */
export function NotificationsTab({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const [audience, setAudience] = useState<Audience>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const canSend = title.trim().length > 0 && body.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) {
      toast.error('Título y mensaje son obligatorios.');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setSending(true);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        url: link.trim() || undefined,
      };
      if (audience === 'all') {
        const res = await api.notifyAll(tournamentId, payload);
        toast.success(
          `Enviado · ${res.totalSubscriptions} ${res.totalSubscriptions === 1 ? 'dispositivo' : 'dispositivos'} suscritos.`,
        );
      } else {
        const res = await api.notifyClubs(tournamentId, payload);
        const n = res.clubsNotified;
        toast.success(
          n === 0
            ? 'No hay clubes con notificaciones activas todavía.'
            : `Enviado a ${n} ${n === 1 ? 'club' : 'clubes'}.`,
        );
      }
      // Reset compose state after a successful send so the admin
      // doesn't accidentally re-fire the same message.
      setTitle('');
      setBody('');
      setLink('');
      setConfirmOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo enviar la notificación'));
      throw err;
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Bell className="w-5 h-5 text-black/60" />
        <h2 className="text-xl font-bold" style={FONT}>
          NOTIFICACIONES
        </h2>
      </div>
      <p className="text-sm text-black/65 leading-relaxed">
        Mandá un aviso push a quien sigue el torneo desde su celular.
        Lo van a ver al instante en el bloqueo de pantalla, incluso
        si la app está cerrada.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Audience picker */}
        <div className="space-y-2">
          <label
            className="text-[11px] font-bold uppercase text-black/60"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            ¿A quién le llega?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AudienceCard
              active={audience === 'all'}
              onClick={() => setAudience('all')}
              icon={<Globe className="w-5 h-5" />}
              title="Todos"
              subtitle="Visitantes del público + capitanes de clubes"
            />
            <AudienceCard
              active={audience === 'clubs'}
              onClick={() => setAudience('clubs')}
              icon={<Building2 className="w-5 h-5" />}
              title="Solo clubes"
              subtitle="Capitanes con sesión activa en el panel"
            />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <label
            htmlFor="notif-title"
            className="text-[11px] font-bold uppercase text-black/60"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            Título <span className="text-spk-red">*</span>
          </label>
          <input
            id="notif-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej. Recordatorio de acreditación"
            maxLength={80}
            className="w-full px-3 py-2.5 text-sm border-2 border-black/10 rounded-sm focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none"
          />
          <p className="text-[10px] text-black/45">
            {title.length}/80 caracteres. Aparece como header de la notif.
          </p>
        </div>

        {/* Body */}
        <div className="space-y-2">
          <label
            htmlFor="notif-body"
            className="text-[11px] font-bold uppercase text-black/60"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            Mensaje <span className="text-spk-red">*</span>
          </label>
          <textarea
            id="notif-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ej. Acreditación abre 30 min antes en INEM Cancha 1. Traer carnet."
            rows={4}
            maxLength={300}
            className="w-full px-3 py-2.5 text-sm border-2 border-black/10 rounded-sm focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none resize-none"
          />
          <p className="text-[10px] text-black/45">
            {body.length}/300 caracteres.
          </p>
        </div>

        {/* Optional link */}
        <div className="space-y-2">
          <label
            htmlFor="notif-link"
            className="text-[11px] font-bold uppercase text-black/60"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            Link al tocar la notificación (opcional)
          </label>
          <input
            id="notif-link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Ej. /club-panel  o  https://torny.app/torneo/copa"
            className="w-full px-3 py-2.5 text-sm border-2 border-black/10 rounded-sm focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none"
          />
          <p className="text-[10px] text-black/45">
            Si lo dejás vacío,{' '}
            {audience === 'all'
              ? 'abre la pestaña pública del torneo.'
              : 'abre el panel del club.'}
          </p>
        </div>

        {/* Preview */}
        {title.trim() && (
          <div className="bg-black/[0.04] border border-black/10 rounded-sm p-3 space-y-1">
            <div
              className="text-[10px] font-bold uppercase text-black/50"
              style={{ ...FONT, letterSpacing: '0.06em' }}
            >
              Vista previa
            </div>
            <div className="bg-white border border-black/15 rounded-sm p-3 shadow-sm">
              <div className="font-bold text-sm">
                {title.trim() || 'Título'}
              </div>
              <div className="text-xs text-black/70 mt-0.5 whitespace-pre-wrap">
                {body.trim() || 'Mensaje…'}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-spk-red hover:bg-spk-red-dark text-white text-sm font-bold rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
          style={{ ...FONT, letterSpacing: '0.04em' }}
        >
          <Send className="w-4 h-4" />
          Enviar notificación
        </button>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !sending) setConfirmOpen(false);
        }}
        title="¿Enviar notificación?"
        description={
          audience === 'all'
            ? `Vamos a notificar a TODOS los suscriptores del torneo "${tournamentName}" (público + capitanes). Una vez enviada no se puede borrar de los dispositivos.`
            : `Vamos a notificar a los capitanes de cada club inscrito en "${tournamentName}". Una vez enviada no se puede borrar.`
        }
        confirmLabel={`Enviar a ${audience === 'all' ? 'todos' : 'clubes'}`}
        variant="default"
        loading={sending}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function AudienceCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-sm border-2 transition-all ${
        active
          ? 'border-spk-red bg-spk-red/5'
          : 'border-black/10 hover:border-black/25 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={active ? 'text-spk-red' : 'text-black/55'}>{icon}</span>
        <span
          className="font-bold text-sm uppercase"
          style={{ ...FONT, letterSpacing: '0.03em' }}
        >
          {title}
        </span>
      </div>
      <div className="text-[11px] text-black/55 leading-snug">{subtitle}</div>
    </button>
  );
}
