import { useCallback, useEffect, useRef, useState } from "react";

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
  const [documentTitle, setDocumentTitle] = useState(loadTitle);
  const [persistedDocumentTitle, setPersistedDocumentTitle] =
    useState(documentTitle);
  const [persistedFingerprint, setPersistedFingerprint] =
    useState<string | null>(initialFingerprint);

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
    (fingerprint: string, title = documentTitle) => {
      setPersistedFingerprint(fingerprint);
      setPersistedDocumentTitle(title.trim() || "Cover letter");
    },
    [documentTitle]
  );

  const startupFingerprint = `${documentTitle}\u0000${currentFingerprint ?? ""}`;
  const startupFingerprintRef = useRef(startupFingerprint);
  startupFingerprintRef.current = startupFingerprint;

  return {
    documentTitle,
    persistedDocumentTitle,
    setDocumentTitle,
    dirty:
      currentFingerprint !== null &&
      currentFingerprint !== persistedFingerprint,
    commitPersistenceBaseline,
    startupFingerprintRef
  };
}
