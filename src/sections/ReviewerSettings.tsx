import { KeyRound } from "lucide-react";
import {
  cliReasoningEffortOptionsByProvider,
  modelOptionsByProvider,
  providerOptions
} from "../config/aiOptions";
import type { AiProviderValue } from "../config/aiOptions";

// Optional independent reviewer for the strict-audit pass. The primary provider
// rewrites (and drafts the cover letter); this lets a *different* model audit
// the result, which avoids the rewriting model's self-consistency bias. The
// audit never edits the resume, so a different reviewer model can't change the
// format-preserved output. Empty `auditProvider` = "Same as primary".
type ReviewerSettingsProps = {
  auditProvider: AiProviderValue | "";
  onAuditProviderChange: (provider: AiProviderValue | "") => void;
  auditApiKey: string;
  setAuditApiKey: (v: string) => void;
  auditApiBaseUrl: string;
  setAuditApiBaseUrl: (v: string) => void;
  auditSelectedModel: string;
  setAuditSelectedModel: (v: string) => void;
  auditCustomModel: string;
  setAuditCustomModel: (v: string) => void;
  auditCliReasoningEffort: string;
  setAuditCliReasoningEffort: (v: string) => void;
};

const OPENAI_COMPATIBLE = ["openrouter", "groq", "together", "mistral", "local"];

export function ReviewerSettings({
  auditProvider,
  onAuditProviderChange,
  auditApiKey,
  setAuditApiKey,
  auditApiBaseUrl,
  setAuditApiBaseUrl,
  auditSelectedModel,
  setAuditSelectedModel,
  auditCustomModel,
  setAuditCustomModel,
  auditCliReasoningEffort,
  setAuditCliReasoningEffort
}: ReviewerSettingsProps) {
  const isCliProvider =
    auditProvider === "claude-cli" || auditProvider === "codex-cli" || auditProvider === "gemini-cli";
  const modelOptions = auditProvider ? modelOptionsByProvider[auditProvider] ?? [] : [];
  const effortOptions = auditProvider ? cliReasoningEffortOptionsByProvider[auditProvider] ?? [] : [];
  const selectedProviderOption = providerOptions.find((option) => option.value === auditProvider);
  const customModelPlaceholder = selectedProviderOption?.model || "model-id";

  return (
    <div className="reviewer-settings">
      <div className="menu-subhead">
        <span className="menu-subhead__title">Reviewer</span>
        <span className="menu-subhead__note">optional · independent audit</span>
      </div>

      <label className="field">
        <span>Audit provider</span>
        <select
          value={auditProvider}
          onChange={(event) => onAuditProviderChange(event.target.value as AiProviderValue | "")}
        >
          <option value="">Same as primary</option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {auditProvider ? (
        <>
          {/* Model + effort pair only when both exist; else model is full width. */}
          <div className={effortOptions.length ? "settings-grid" : "provider-config__single"}>
            <label className="field">
              <span>Reviewer model</span>
              <select value={auditSelectedModel} onChange={(event) => setAuditSelectedModel(event.target.value)}>
                {modelOptions.map((option) => (
                  <option key={option.value || "server-default"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {effortOptions.length ? (
              <label className="field">
                <span>Reasoning effort</span>
                <select
                  value={auditCliReasoningEffort}
                  onChange={(event) => setAuditCliReasoningEffort(event.target.value)}
                >
                  {effortOptions.map((option) => (
                    <option key={option.value || "cli-default-effort"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {auditSelectedModel === "custom" ? (
            <label className="field">
              <span>Reviewer model ID</span>
              <input
                className="text-input"
                value={auditCustomModel}
                onChange={(event) => setAuditCustomModel(event.target.value)}
                placeholder={customModelPlaceholder}
                type="text"
              />
            </label>
          ) : null}

          {!isCliProvider ? (
            <label className="field">
              <span>Reviewer API key</span>
              <div className="input-with-icon">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  autoComplete="off"
                  value={auditApiKey}
                  onChange={(event) => setAuditApiKey(event.target.value)}
                  placeholder="Uses this provider's .env key when blank"
                  type="password"
                />
              </div>
            </label>
          ) : null}

          {OPENAI_COMPATIBLE.includes(auditProvider) ? (
            <label className="field">
              <span>Reviewer base URL</span>
              <input
                className="text-input"
                value={auditApiBaseUrl}
                onChange={(event) => setAuditApiBaseUrl(event.target.value)}
                placeholder="https://provider.example/v1"
                type="url"
              />
            </label>
          ) : null}

          <p className="micro-status">
            A different model audits the rewrite. The audit only scores and flags — it never edits the resume, so it
            can't change your formatting.
          </p>
        </>
      ) : null}
    </div>
  );
}
