/**
 * TornyTrophy — la copa geométrica del logo Torny extraída como componente
 * reutilizable. Misma silueta, paths y antena (punto rojo + línea roja) que el
 * wordmark grande, pero escalable a cualquier tamaño vía className.
 *
 * El SVG usa `currentColor` para el trazo, así que el color sale del CSS:
 * - `text-white` (default) en headers oscuros
 * - `text-black` en superficies claras
 * El acento rojo de la antena queda hardcoded a #E31E24 (color de marca).
 *
 * El viewBox `-90 -90 180 160` deja la copa centrada con margen para que se
 * vea respirar dentro de un badge cuadrado.
 */
export function TornyTrophy({
  className = 'w-6 h-6',
  strokeWidth = 9,
}: {
  className?: string;
  /** Grosor del trazo (en unidades del viewBox). Default 6 para badges chicos. */
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="-90 -90 180 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Body de la copa — trapecio invertido */}
      <polygon
        points="-52,-58 52,-58 38,38 -38,38"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Línea horizontal interior (decorativa) */}
      <line
        x1="-30"
        y1="10"
        x2="30"
        y2="10"
        stroke="currentColor"
        strokeWidth={strokeWidth * 0.5}
        opacity="0.3"
      />
      {/* Asa izquierda */}
      <polyline
        points="-52,-28 -76,-28 -76,18 -52,18"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Asa derecha */}
      <polyline
        points="52,-28 76,-28 76,18 52,18"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Pedestal — dos verticales */}
      <line
        x1="-10"
        y1="38"
        x2="-10"
        y2="58"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1="10"
        y1="38"
        x2="10"
        y2="58"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Pedestal — base horizontal */}
      <line
        x1="-36"
        y1="58"
        x2="36"
        y2="58"
        stroke="currentColor"
        strokeWidth={strokeWidth * 1.15}
        strokeLinecap="round"
      />
      {/* Antena: punto rojo + línea hacia la copa (mismo color del wordmark) */}
      <circle cx="0" cy="-72" r="6" fill="#E31E24" />
      <line
        x1="0"
        y1="-66"
        x2="0"
        y2="-58"
        stroke="#E31E24"
        strokeWidth={strokeWidth * 0.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
