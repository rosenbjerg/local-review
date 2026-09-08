import type { DiffStat } from "../diffStats";
import { isEmptyStat } from "../diffStats";

// The `+N -M` line counts; renders nothing when there's nothing to count, or a binary file would read "+0 -0".
export function DiffStatBadge({ stat, title }: { stat: DiffStat; title?: string }) {
  if (isEmptyStat(stat)) return null;
  return (
    <span className="diff-stat" title={title ?? `${stat.added} added, ${stat.removed} removed`}>
      {stat.added > 0 && <span className="stat-add">+{stat.added}</span>}
      {stat.removed > 0 && <span className="stat-del">-{stat.removed}</span>}
    </span>
  );
}
