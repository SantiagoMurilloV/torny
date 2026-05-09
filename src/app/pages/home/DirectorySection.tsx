import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Search, RefreshCw } from 'lucide-react';
import type { Tournament } from '../../types';
import { TournamentCard } from '../../components/TournamentCard';
import { TournamentCardSkeleton } from '../../components/SkeletonLoaders';
import { DirectoryFilters } from './DirectoryFilters';
import type { StatusFilter } from './useFilterDeepLink';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

export interface StatusCounts {
  all: number;
  ongoing: number;
  upcoming: number;
  completed: number;
}

/**
 * Public tournaments directory — search + status filter pills, then
 * the 3-column card grid. Handles its own skeleton + error UI so the
 * parent can stay focused on layout.
 */
export function DirectorySection({
  tournaments,
  statusCounts,
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterChange,
  loading,
  error,
  onRetry,
}: {
  tournaments: Tournament[];
  statusCounts: StatusCounts;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  filterStatus: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const navigate = useNavigate();

  return (
    <section id="directory" className="bg-white text-black py-14 md:py-20 scroll-mt-20">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-8 md:mb-10"
        >
          <div
            className="text-[11px] text-spk-red uppercase tracking-[0.28em] mb-3"
            style={FONT}
          >
            Temporada 2026
          </div>
          <h2
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter leading-[0.95]"
            style={FONT}
          >
            TODOS LOS TORNEOS
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <div className="w-20 h-1 bg-spk-red" />
            <p className="text-sm md:text-base text-black/55 max-w-xl leading-relaxed">
              Explora torneos en curso, próximos y ya finalizados. Toca cualquier torneo para
              ver cruces, tablas y resultados en vivo.
            </p>
          </div>
        </motion.div>

        <DirectoryFilters
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          filterStatus={filterStatus}
          onFilterChange={onFilterChange}
          statusCounts={statusCounts}
        />

        {loading ? (
          <div className="grid gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <TournamentCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-6">⚠️</div>
            <h3 className="text-2xl font-bold mb-3" style={FONT}>
              ERROR AL CARGAR TORNEOS
            </h3>
            <p className="text-black/60 mb-6">{error}</p>
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white rounded-sm font-bold hover:bg-black/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
          </div>
        ) : tournaments.length > 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="grid gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3"
          >
            {tournaments.map((tournament, index) => (
              <motion.div
                key={tournament.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                whileHover={{ y: -6 }}
                onClick={() => navigate(`/tournament/${tournament.id}`)}
                className="cursor-pointer"
              >
                <TournamentCard tournament={tournament} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <Search className="w-16 h-16 text-black/20 mx-auto mb-6" />
            <h3 className="text-2xl font-bold mb-3" style={FONT}>
              NO SE ENCONTRARON TORNEOS
            </h3>
            <p className="text-black/60">Intenta con otros términos de búsqueda</p>
          </motion.div>
        )}
      </div>
    </section>
  );
}
