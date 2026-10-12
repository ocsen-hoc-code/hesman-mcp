import type { ReactElement } from 'react';

/** Props accepted by the badge. */
export interface BadgeProps {
  label: string;
  count?: number;
}

/** Formats the counter shown next to the label. */
function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** A small badge with an optional counter. */
export function Badge({ label, count = 0 }: BadgeProps): ReactElement {
  return (
    <span className="badge">
      {label}
      {count > 0 && <em>{formatCount(count)}</em>}
    </span>
  );
}

/** Renders one badge per item. */
export const BadgeList = ({ items }: { items: BadgeProps[] }): ReactElement => (
  <ul>
    {items.map((item) => (
      <li key={item.label}>
        <Badge {...item} />
      </li>
    ))}
  </ul>
);
