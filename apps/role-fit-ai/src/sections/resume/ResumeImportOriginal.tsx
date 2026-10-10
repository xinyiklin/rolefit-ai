import { useState } from "react";
import { Document, Page } from "react-pdf";

import "../../lib/browserPdfjs.ts";

// The imported PDF's pages at rail width. Loaded lazily with React-PDF so the
// editor bundle does not carry a PDF renderer it rarely needs.
export default function ResumeImportOriginal({ url, fileName }: { url: string; fileName: string }) {
  const [pageCount, setPageCount] = useState(0);
  return (
    <Document
      file={url}
      className="resume-import__pages"
      onLoadSuccess={({ numPages }) => setPageCount(numPages)}
      loading={<p className="resume-import__note">Loading the original…</p>}
      error={<p className="resume-import__note">The original PDF can't be shown here.</p>}
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <Page
          key={index}
          pageNumber={index + 1}
          width={560}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className="resume-import__page"
          aria-label={`${fileName}, page ${index + 1} of ${pageCount}`}
        />
      ))}
    </Document>
  );
}
