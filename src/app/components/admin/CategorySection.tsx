import { useState, type ReactNode, type ComponentType } from 'react';
import { ChevronDown, type LucideProps } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type LucideIcon = ComponentType<LucideProps>;

interface CategorySectionProps {
  title: string;
  /** Optional right-aligned badge text (e.g. team count). */
  count?: number | string;
  /** Optional subtitle below the title (e.g. "4 grupos · 12 partidos"). */
  subtitle?: string;
  /** Start expanded. Defaults to false so admins open what they need. */
  defaultOpen?: boolean;
  /**
   * External override that pins the section open. Used by parent views
   * (e.g. TeamsTab when the admin types in the search box) to force
   * every matching category open without clobbering the user's manual
   * collapse state — when `forceOpen` flips back to `undefined`, the
   * component reverts to whatever the admin last toggled internally.
   */
  forceOpen?: boolean;
  /**
   * Optional leading icon shown before the title (e.g. Award for
   * División Oro, Medal for División Plata).
   */
  icon?: LucideIcon;
  /**
   * Tailwind text color classes applied to the icon + title so each
   * tier / group can carry its own visual tone (e.g. `text-amber-500`
   * for Oro, `text-slate-400` for Plata). Overrides the default
   * `text-black/70` title color when provided.
   */
  accentClassName?: string;
  children: ReactNode;
}

/**
 * CategorySection — collapsible accordion card used in the admin tournament
 * detail for each category configured on the tournament so
 * long pages fold into a single tap-to-open list. Header is a button; body
 * animates height with motion.
 */
export function CategorySection({
  title,
  count,
  subtitle,
  defaultOpen = false,
  forceOpen,
  icon: Icon,
  accentClassName,
  children,
}: CategorySectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  // `forceOpen` (when defined) overrides the local toggle so the parent
  // can pin the section open during search — but the click handler is
  // a no-op in that case, so the chevron animation reads as "locked
  // open" rather than out-of-sync with the toggle. When `forceOpen` is
  // undefined the component is fully self-controlled.
  const open = forceOpen ?? internalOpen;
  const contentId = `cat-body-${title.replace(/\s+/g, '-')}`;
  const accentTextClass = accentClassName ?? 'text-black/70';

  return (
    <div className="border-b border-black/10 last:border-b-0">
      <button
        type="button"
        onClick={() => {
          if (forceOpen === undefined) setInternalOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls={contentId}
        className={`w-full flex items-center justify-between gap-3 px-1 py-3 text-left transition-colors ${
          accentClassName ? `${accentTextClass} hover:opacity-80` : 'text-black/70 hover:text-black'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`inline-flex ${accentClassName ? accentTextClass : 'text-black/40'}`}
            aria-hidden="true"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.span>
          {Icon && (
            <Icon
              className={`w-4 h-4 flex-shrink-0 ${accentTextClass}`}
              aria-hidden="true"
            />
          )}
          <span
            className={`text-sm font-semibold uppercase truncate ${accentTextClass}`}
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.1em' }}
          >
            {title}
          </span>
          {count !== undefined && (
            <span
              className="text-[11px] text-black/45 tabular-nums font-medium"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              ({count})
            </span>
          )}
        </div>
        {subtitle && (
          <span
            className="hidden sm:inline text-[11px] text-black/40 uppercase tracking-wider flex-shrink-0"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.12em' }}
          >
            {subtitle}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pt-1 pb-5 px-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
