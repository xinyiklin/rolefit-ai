// Types + helpers shared across the section components.

import type { ChangeEvent } from "react";
import type { PolishedResume, ResumeAnalysis } from "../resumeEngine";

export type OutputTab = "resume" | "review" | "cover" | "strict" | "pipeline";

export type OutputTabDescriptor = {
  id: OutputTab;
  label: string;
  badge?: string | number;
};

export type SourceDocx = {
  name: string;
  base64: string;
  paragraphs: number;
};

export type ResumeBlockKind = "contact" | "section" | "bullet" | "text";

export type ResumeBlock = {
  id: string;
  kind: ResumeBlockKind;
  text: string;
};

export type ScoreSource = PolishedResume | ResumeAnalysis | null;

export type ChangeHandler = (event: ChangeEvent<HTMLInputElement>) => void;

export function scoreLabel(score: number) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 55) return "Needs polish";
  return "Needs work";
}

export function blockKindLabel(kind: ResumeBlockKind) {
  return (
    {
      contact: "Contact",
      section: "Section",
      bullet: "Bullet",
      text: "Text"
    }[kind] ?? "Text"
  );
}

export function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return iso;
  }
}

export function formatRelativeAge(iso: string) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "1d ago";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  } catch {
    return "";
  }
}
