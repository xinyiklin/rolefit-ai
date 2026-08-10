import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import { coverLetterDocumentVersion } from "../lib/coverLetterWorkspaceOwnership.ts";
import { coverLetterRecoveryDirty } from "../lib/coverLetterRecovery.ts";

const TITLE_STORAGE_KEY = "rolefit:coverLetterTitle.v1";

function loadTitle(): string {
  try {
    return window.sessionStorage.getItem(TITLE_STORAGE_KEY)?.trim() || "Cover letter";
  } catch {
    return "Cover letter";
  }
}

export function useCoverLetterDocumentIdentity(
  initialFingerprint: string,
  currentFingerprint: string | null
) {
  const [documentTitle, setDocumentTitleState] = useState(loadTitle);
  const [persistedDocumentTitle, setPersistedDocumentTitle] =
    useState(documentTitle);
  const [persistedFingerprint, setPersistedFingerprint] =
    useState<string | null>(initialFingerprint);
  const currentFingerprintRef = useRef(currentFingerprint);
  currentFingerprintRef.current = currentFingerprint;
  const documentTitleRef = useRef(documentTitle);
  const documentVersion = coverLetterDocumentVersion(currentFingerprint, documentTitle);
  const documentVersionRef = useRef(documentVersion);
  documentVersionRef.current = documentVersion;
  const setDocumentTitle = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    const resolved =
      typeof next === "function" ? next(documentTitleRef.current) : next;
    documentTitleRef.current = resolved;
    documentVersionRef.current = coverLetterDocumentVersion(
      currentFingerprintRef.current,
      resolved
    );
    setDocumentTitleState(resolved);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        TITLE_STORAGE_KEY,
        documentTitle.trim() || "Cover letter"
      );
    } catch {
      // The in-memory title remains authoritative for this session.
    }
  }, [documentTitle]);

  const commitPersistenceBaseline = useCallback(
    (fingerprint: string, title = documentTitleRef.current) => {
      setPersistedFingerprint(fingerprint);
      setPersistedDocumentTitle(title.trim() || "Cover letter");
    },
    []
  );

  const documentDirty =
    currentFingerprint !== null &&
    currentFingerprint !== persistedFingerprint;
  const recoveryDirty = coverLetterRecoveryDirty({
    documentDirty,
    documentTitle,
    persistedDocumentTitle
  });

  return {
    documentTitle,
    persistedDocumentTitle,
    setDocumentTitle,
    dirty: documentDirty,
    recoveryDirty,
    commitPersistenceBaseline,
    documentTitleRef,
    documentVersion,
    documentVersionRef
  };
}
