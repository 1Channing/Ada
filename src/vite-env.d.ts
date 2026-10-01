/// <reference types="vite/client" />

// Build legacy de pdf.js (polyfills) : même API que le module principal.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' { export * from 'pdfjs-dist'; }

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
