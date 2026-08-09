import type { DiffStat } from "../diffStats";
import { isEmptyStat } from "../diffStats";

// The `+N -M` line counts, shown on a file card, an explorer row and the review
// total. Renders nothing when there's nothing to count — a binary file or a file
// opened just to comment on would otherwise read as "+0 -0", i.e. unchanged.
export function DiffStatBadge({ stat, title }: { stat: DiffStat; title?: string }) {
  if (isEmptyStat(stat)) return null;
  return (
    <span className="diff-stat" title={title ?? `${stat.added} added, ${stat.removed} removed`}>
      {stat.added > 0 && <span className="stat-add">+{stat.added}</span>}
      {stat.removed > 0 && <span className="stat-del">-{stat.removed}</span>}
    </span>
  );
}
