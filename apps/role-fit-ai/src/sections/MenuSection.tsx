import { useId, type ReactNode } from "react";

type MenuSectionProps = {
  title: string;
  // Optional stage-local control kept beside the static heading.
  headerControl?: ReactNode;
  children: ReactNode;
};

// A permanently visible semantic section inside the AI menu. Distill, Tailor,
// and Review are one compact setup form, so stage headings label content rather
// than acting as nested disclosure controls.
export function MenuSection({ title, headerControl, children }: MenuSectionProps) {
  const headingId = useId();
  return (
    <section className="menu-section" aria-labelledby={headingId}>
      <div className="menu-section__header">
        <h3 id={headingId} className="menu-subhead__title">{title}</h3>
        {headerControl ?? null}
      </div>
      <div className="menu-section__body">{children}</div>
    </section>
  );
}
