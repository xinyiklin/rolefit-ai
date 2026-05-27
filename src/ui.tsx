import { ReactNode } from "react";

export function ScoreMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-meter">
      <div className="score-meter__label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="score-meter__track" aria-hidden="true">
        <div className="score-meter__fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ChipList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items.length) return <p className="muted-line">{emptyText}</p>;

  return (
    <div className="chip-list">
      {items.map((item) => (
        <span className="chip" key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function PanelHeading({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="panel__heading">
      {icon}
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}
