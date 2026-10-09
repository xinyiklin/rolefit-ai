// The browser's one pdf.js configuration, with the bundled worker so no
// static-asset setup is needed. It goes through React-PDF's export on purpose:
// React-PDF assigns its own default worker path when it first loads, so ours
// must be set after that module has run, whichever caller loads first.
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export { pdfjs };
