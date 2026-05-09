import { X } from 'lucide-react';

interface FixtureModeDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectAutomatic: () => void;
  onSelectManual: () => void;
}

/**
 * First step of the generate-fixtures flow. The admin picks between
 * letting the backend shuffle teams into groups (automatic) or
 * deciding the groups manually. Consumed by the Cruces tab.
 */
export function FixtureModeDialog({
  open,
  onClose,
  onSelectAutomatic,
  onSelectManual,
}: FixtureModeDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-0"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-sm shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h2
            className="text-xl font-bold"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            CREACIÓN DE GRUPOS
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-black/60 mb-6">
          Elegí cómo querés armar los grupos del torneo:
        </p>

        <div className="space-y-3">
          <button
            onClick={onSelectAutomatic}
            className="w-full p-4 border-2 border-black/10 rounded-sm hover:border-spk-blue hover:bg-spk-blue/5 transition-all text-left"
          >
            <p
              className="font-bold text-base"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              AUTOMÁTICO
            </p>
            <p className="text-sm text-black/60 mt-1">
              Los equipos se asignan aleatoriamente a los grupos y posiciones.
            </p>
          </button>
          <button
            onClick={onSelectManual}
            className="w-full p-4 border-2 border-black/10 rounded-sm hover:border-spk-red hover:bg-spk-red/5 transition-all text-left"
          >
            <p
              className="font-bold text-base"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              MANUAL
            </p>
            <p className="text-sm text-black/60 mt-1">
              Vos elegís qué equipos van en cada grupo o posición del cruce.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
