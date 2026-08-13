export type ApplicationActionStatus = {
  tone: "success" | "error";
  headline: string;
  detail?: string;
};

export function statusDetail(...parts: Array<string | undefined>): string | undefined {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" ") || undefined;
}
