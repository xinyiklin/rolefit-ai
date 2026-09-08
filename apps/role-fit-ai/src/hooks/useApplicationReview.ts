import { useEffect, useRef, useState } from "react";
import {
  applicationReviewEvidenceLimitError,
  localApplicationReview,
  sanitizeApplicationReviewResult,
  type ApplicationReviewInput,
  type ApplicationReviewResult,
} from "../../shared/applicationReviewContract.ts";
import {
  applicationReviewDependencies,
  reviewRequestIsCurrent,
} from "../lib/applicationReview";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import type { ProviderReadiness } from "./useAvailableProviders";
import { classifyFailure, ApiError } from "../lib/failures";

type ReviewReceipt = {
  result: ApplicationReviewResult;
  identity: string;
  dependencies: ReturnType<typeof applicationReviewDependencies>;
};
export function useApplicationReview({
  input,
  stage,
  preparationIdentity,
  ensureProviderReady,
}: {
  input: ApplicationReviewInput;
  stage: StageConfig;
  preparationIdentity: string;
  ensureProviderReady: () => Promise<ProviderReadiness>;
}) {
  const settings = buildStageRequestFields(stage);
  const identity = JSON.stringify([preparationIdentity, input, settings]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<
    "idle" | "running" | "completed" | "failed" | "stopped"
  >("idle");
  const [receipt, setReceipt] = useState<ReviewReceipt | null>(null);
  const [previous, setPrevious] = useState<ReviewReceipt | null>(null);
  const dependencies = applicationReviewDependencies(input, settings);

  useEffect(() => {
    if (!controller.current) return;
    generation.current += 1;
    controller.current.abort();
    controller.current = null;
    setStatus("stopped");
  }, [identity]);
  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
    },
    [],
  );

  function stop() {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setStatus("stopped");
  }
  async function run() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const requestGeneration = ++generation.current;
    const current = () =>
      reviewRequestIsCurrent(
        requestGeneration,
        generation.current,
        identity,
        currentIdentity.current,
        abort.signal,
      );
    const local = localApplicationReview(input);
    setPrevious((old) => (receipt && status === "completed" ? receipt : old));
    setReceipt({ result: local, identity, dependencies });
    if (!local.reviewedDocuments.length) {
      controller.current = null;
      setStatus("completed");
      return;
    }
    setStatus("running");
    try {
      const evidenceError = applicationReviewEvidenceLimitError(input.evidence);
      if (evidenceError) throw new Error(evidenceError);
      const provider = await ensureProviderReady();
      if (!current()) return;
      if (!provider.ready) throw new Error(provider.message);
      const response = await fetch("/api/application-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, ...settings }),
        signal: abort.signal,
      });
      const raw = await response.json();
      if (!current()) return;
      if (!response.ok)
        throw new ApiError(
          raw.error || "Final review failed.",
          response.status,
        );
      const result = sanitizeApplicationReviewResult(raw, input);
      if (!result)
        throw new ApiError("Final review returned an invalid result.", 422);
      setReceipt({ result, identity, dependencies });
      setStatus(result.error ? "failed" : "completed");
    } catch (error) {
      if (!current()) return;
      const failure = classifyFailure(error);
      setReceipt({
        result: {
          ...local,
          error: `${failure.headline}: ${failure.detail}`,
          complete: false,
        },
        identity,
        dependencies,
      });
      setStatus("failed");
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }
  return {
    status,
    receipt,
    previous,
    stale: Boolean(receipt && receipt.identity !== identity),
    run,
    stop,
    findingStale: (finding: ApplicationReviewResult["findings"][number]) =>
      Boolean(
        receipt &&
        finding.dependencies.some(
          (key) => receipt.dependencies[key] !== dependencies[key],
        ),
      ),
  };
}
