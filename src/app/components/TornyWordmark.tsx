/**
 * TornyWordmark — wordmark unificado para todos los headers de la app.
 *
 * Reemplaza la combinación legacy de "ícono cuadrado (Trophy/Shield/
 * Radio) + texto plain 'Torny'" que vivía duplicada en HomeHeader,
 * Login, AdminLayout, JudgeLayout y SuperAdminLayout.
 *
 * Composición (igual al wordmark del landing, pero como SVG inline para
 * que la coloración respete el tema oscuro de la app):
 *   • Pelota de voley geométrica con dot rojo central (live indicator)
 *   • Línea vertical separadora
 *   • Texto "TORN" + "Y" roja (el wordmark de la marca Torny)
 *
 * Variantes:
 *   - `full` (default): pelota + separador + TORNY     → para sidebars
 *     desktop, login, footers
 *   - `compact`: pelota + TORNY (sin separador)        → headers mobile
 *     o cuando el espacio es chico
 *   - `mark`: solo la pelota geométrica con dot rojo   → favicon-style,
 *     para áreas muy chicas (botones flotantes)
 *
 * Tamaños via prop `height` en px (default 40). El SVG escala
 * proporcionalmente (ratio fijo).
 *
 * Color del wordmark se controla con `accentClassName` para el contenedor
 * (afecta los strokes de la pelota vía `currentColor`) y la "Y" siempre
 * es roja (#E31E24, el spk-red).
 */

interface TornyWordmarkProps {
  /** Variante de composición. Default: 'full' */
  variant?: 'full' | 'compact' | 'mark';
  /** Altura en px. El ancho se calcula proporcional. Default 40 */
  height?: number;
  /** Clase para el contenedor (coloriza strokes via currentColor). Default text-white */
  className?: string;
  /** Etiqueta accesible. Default 'Torny' */
  title?: string;
}

export function TornyWordmark({
  variant = 'full',
  height = 40,
  className = '',
  title = 'Torny',
}: TornyWordmarkProps) {
  // viewBox y aspect ratio fijos por variante. width auto via CSS.
  const config = (() => {
    switch (variant) {
      case 'mark':
        return { viewBox: '-2 -2 48 48', aspect: 48 / 48 };
      case 'compact':
        return { viewBox: '-2 0 250 90', aspect: 250 / 90 };
      case 'full':
      default:
        return { viewBox: '-20 0 360 90', aspect: 360 / 90 };
    }
  })();

  const width = Math.round(height * config.aspect);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={config.viewBox}
      width={width}
      height={height}
      role="img"
      aria-label={title}
      className={`spk-wordmark flex-shrink-0 ${className}`}
    >
      <title>{title}</title>

      {/* Pelota de voley geométrica (común a todas las variantes salvo
          'mark', donde es el único contenido) */}
      {variant === 'mark' ? (
        <g transform="translate(22, 22)">
          <g
            stroke="currentColor"
            strokeWidth={2.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="0" cy="0" r="20" />
            <path d="M -20 -4 C -12 -7 12 -7 20 -4" />
            <path d="M -20 4 C -12 7 12 7 20 4" />
            <path d="M -4 -20 C -7 -12 -7 12 -4 20" />
            <path d="M 4 -20 C 7 -12 7 12 4 20" />
          </g>
          <circle cx="0" cy="0" r="3" fill="#E31E24" />
        </g>
      ) : (
        <>
          <g transform="translate(40, 45)">
            <g
              stroke="currentColor"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="0" cy="0" r="22" />
              <path d="M -22 -4 C -13 -8 13 -8 22 -4" />
              <path d="M -22 4 C -13 8 13 8 22 4" />
              <path d="M -4 -22 C -8 -13 -8 13 -4 22" />
              <path d="M 4 -22 C 8 -13 8 13 4 22" />
            </g>
            <circle cx="0" cy="0" r="2.8" fill="#E31E24" />
          </g>

          {/* Línea separadora (solo en 'full') */}
          {variant === 'full' && (
            <line
              x1="76"
              y1="18"
              x2="76"
              y2="72"
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.25"
            />
          )}

          {/* Wordmark TORN + Y roja */}
          <text
            x={variant === 'full' ? 218 : 145}
            y="58"
            fontFamily="'Arial Black','Impact','Haettenschweiler',sans-serif"
            fontWeight={900}
            fontSize="52"
            letterSpacing="-1"
            textAnchor="middle"
            fill="currentColor"
          >
            TORN<tspan fill="#E31E24">Y</tspan>
          </text>
        </>
      )}
    </svg>
  );
}

export default TornyWordmark;
