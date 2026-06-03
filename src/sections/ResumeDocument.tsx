import type { ReactNode } from "react";
import type { ResumeBlock, ResumeDocumentModel } from "../lib/resumeDocument";

// Presentational render of the parsed resume model as semantic HTML. The same
// component renders the on-screen Resume tab and the off-screen print layer, so
// what you read is exactly what window.print() produces.

function renderBlocks(blocks: ResumeBlock[]): ReactNode[] {
  const out: ReactNode[] = [];
  let bullets: string[] = [];

  // Consecutive bullets collapse into one <ul> so list semantics and spacing are
  // correct.
  function flushBullets(key: string) {
    if (!bullets.length) return;
    out.push(
      <ul className="resume-doc__bullets" key={`ul-${key}`}>
        {bullets.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    );
    bullets = [];
  }

  blocks.forEach((block, index) => {
    if (block.kind === "bullet") {
      bullets.push(block.text);
      return;
    }
    flushBullets(String(index));
    if (block.kind === "role") {
      out.push(
        <div className="resume-doc__role" key={index}>
          <span className="resume-doc__role-left">{block.left}</span>
          {block.right ? <span className="resume-doc__role-right">{block.right}</span> : null}
        </div>
      );
    } else {
      out.push(
        <p className="resume-doc__para" key={index}>
          {block.text}
        </p>
      );
    }
  });

  flushBullets("end");
  return out;
}

export function ResumeDocument({ model }: { model: ResumeDocumentModel }) {
  return (
    <article className="resume-doc">
      {model.name ? <h1 className="resume-doc__name">{model.name}</h1> : null}
      {model.contact ? <p className="resume-doc__contact">{model.contact}</p> : null}
      {model.sections.map((section, index) => (
        <section className="resume-doc__section" key={index}>
          {section.heading ? <h2 className="resume-doc__heading">{section.heading}</h2> : null}
          {renderBlocks(section.blocks)}
        </section>
      ))}
    </article>
  );
}
