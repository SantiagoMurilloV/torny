import { Award, Medal } from 'lucide-react';
import { BracketMatch } from '../../../../types';
import { Badge } from '../../../../components/ui/badge';
import { CategorySection } from '../../../../components/admin/CategorySection';
import { ScoreSetsEditor } from '../../../../components/admin/ScoreSetsEditor';
import { TeamAvatar } from '../../../../components/TeamAvatar';
import {
  categoryOfBracketRound,
  bracketRoundName,
  tierOfBracketRound,
  type BracketTier,
} from '../../../../lib/phase';
import type { useScoreEditor } from '../../../../hooks/useScoreEditor';

type BracketEditor = ReturnType<typeof useScoreEditor<BracketMatch>>;

interface TierBucket {
  tier: BracketTier | null;
  matches: BracketMatch[];
}

/**
 * Group a category's bracket rows by tier. Keeps the tier order
 * stable (gold → silver → null) so the UI doesn't shuffle between
 * renders when new matches stream in.
 */
function groupByTier(rows: BracketMatch[]): TierBucket[] {
  const map = new Map<BracketTier | null, BracketMatch[]>();
  for (const r of rows) {
    const tier = tierOfBracketRound(r.round);
    if (!map.has(tier)) map.set(tier, []);
    map.get(tier)!.push(r);
  }
  const tierOrder: Array<BracketTier | null> = ['gold', 'silver', null];
  const buckets: TierBucket[] = [];
  for (const t of tierOrder) {
    const ms = map.get(t);
    if (ms && ms.length > 0) buckets.push({ tier: t, matches: ms });
  }
  return buckets;
}

function tierHeading(tier: BracketTier) {
  return tier === 'gold' ? 'División Oro' : 'División Plata';
}

/**
 * Visual accents shared with BracketCrossingsModal + public BracketView:
 *   · Oro   → Award + amber-500
 *   · Plata → Medal + slate-400
 * Centralised here so every place that labels a tier looks the same.
 */
const TIER_ACCENT: Record<BracketTier, { icon: typeof Award; className: string }> = {
  gold: { icon: Award, className: 'text-amber-500' },
  silver: { icon: Medal, className: 'text-slate-400' },
};

/**
 * Bracket-match list organized by category — collapses to accordions
 * when there's more than one category, else renders inline. Each row
 * has an inline score editor tied to the shared `BracketEditor` hook.
 * Within a category, rows are further split by tier (Oro / Plata)
 * when the tournament uses the division format.
 */
export function BracketByCategory({
  bracketMatches,
  editor,
}: {
  bracketMatches: BracketMatch[];
  editor: BracketEditor;
}) {
  const categoryMap = new Map<string, BracketMatch[]>();
  for (const bm of bracketMatches) {
    const category = categoryOfBracketRound(bm.round);
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category)!.push(bm);
  }
  const categories = [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const hasMultipleCategories =
    categories.length > 1 || (categories.length === 1 && categories[0][0] !== '');

  const renderRows = (rows: BracketMatch[]) => (
    <div className="space-y-2">
      {rows.map((bm) => (
        <BracketRow key={bm.id} match={bm} editor={editor} />
      ))}
    </div>
  );

  const renderCategoryBody = (rows: BracketMatch[]) => {
    const buckets = groupByTier(rows);
    // Legacy single-bracket (null tier) renders inline without a
    // sub-accordion — no need to force the admin to click twice.
    if (buckets.length === 1 && buckets[0].tier === null) {
      return renderRows(buckets[0].matches);
    }
    // Oro/Plata: each tier gets its own collapsible so the admin can
    // expand them independently, mirroring the category-level dropdowns.
    // The section carries the tier's accent (amber for Oro, slate for
    // Plata) so the two brackets read apart at a glance.
    return (
      <div className="space-y-0">
        {buckets.map((b) => {
          if (!b.tier) return <div key="_none">{renderRows(b.matches)}</div>;
          const accent = TIER_ACCENT[b.tier];
          return (
            <CategorySection
              key={b.tier}
              title={tierHeading(b.tier)}
              count={b.matches.length}
              icon={accent.icon}
              accentClassName={accent.className}
            >
              {renderRows(b.matches)}
            </CategorySection>
          );
        })}
      </div>
    );
  };

  if (!hasMultipleCategories) {
    return (
      <div>
        <h3
          className="text-lg font-bold mb-3"
          style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
        >
          Cruces de Eliminación
        </h3>
        {renderCategoryBody(categories[0]?.[1] ?? [])}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map(([category, rows]) => (
        <CategorySection
          key={category || '_default_bracket'}
          title={`Cruces · ${category}`}
          count={rows.length}
          subtitle={`${rows.length} ${rows.length === 1 ? 'partido' : 'partidos'}`}
        >
          {renderCategoryBody(rows)}
        </CategorySection>
      ))}
    </div>
  );
}

function BracketRow({ match: bm, editor }: { match: BracketMatch; editor: BracketEditor }) {
  const displayRound = bracketRoundName(bm.round);
  const isEditing = editor.isEditing(bm);

  return (
    <div className="p-3 bg-white border border-black/10 rounded-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {bm.team1 ? (
            <>
              {/* TeamAvatar handles logo / initials fallback. The hardcoded
                  square here ignored team.logo so even teams with crests
                  uploaded showed only initials in the bracket admin. */}
              <TeamAvatar team={bm.team1} size="sm" />
              <span className="text-sm font-medium truncate">{bm.team1.name}</span>
            </>
          ) : (
            <span className="text-sm text-black/40 italic">Por definir</span>
          )}
        </div>
        <div className="px-4 text-center flex-shrink-0">
          {bm.score ? (
            <span
              className="text-lg font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {bm.score.team1} — {bm.score.team2}
            </span>
          ) : (
            <Badge variant="outline">{displayRound}</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
          {bm.team2 ? (
            <>
              <span className="text-sm font-medium truncate text-right">{bm.team2.name}</span>
              <TeamAvatar team={bm.team2} size="sm" />
            </>
          ) : (
            <span className="text-sm text-black/40 italic">Por definir</span>
          )}
        </div>
      </div>

      {isEditing ? (
        <ScoreSetsEditor
          sets={editor.sets}
          status={editor.status}
          saving={editor.saving}
          onAddSet={editor.addSet}
          onRemoveSet={editor.removeSet}
          onUpdateSet={editor.updateSet}
          onStatusChange={editor.setStatus}
          onSave={() => editor.commit(bm)}
          onCancel={editor.cancel}
        />
      ) : (
        bm.team1 &&
        bm.team2 && (
          // Bracket-stage matches now materialize as regular `matches`
          // rows the moment both teams resolve. The marker / referee
          // flow lives there (Partidos tab + /judge console), so the
          // bracket card itself is read-only — we surface a hint to
          // point the admin at the right place.
          <div className="flex justify-end mt-2">
            <span className="text-[11px] text-black/40 italic">
              Editar desde la pestaña Partidos
            </span>
          </div>
        )
      )}
    </div>
  );
}
