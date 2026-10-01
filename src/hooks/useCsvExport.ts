'use client';

import { useCallback } from 'react';

/**
 * Triggers a CSV download.
 *
 * The Blob URL is revoked immediately after the click, so a long session that
 * exports often does not accumulate object URLs. The anchor is never appended to
 * the document: modern browsers accept a click on a detached anchor, and
 * attaching it would cause a layout shift.
 *
 * A BOM is already present in the generated text; it goes into the Blob as UTF-8,
 * which is what makes Excel read the file without mangling accented names.
 */

export interface CsvExportRequest {
  filename: string;
  contents: string;
}

export interface UseCsvExportResult {
  download: (request: CsvExportRequest) => void;
}

export function useCsvExport(): UseCsvExportResult {
  const download = useCallback(({ filename, contents }: CsvExportRequest) => {
    if (typeof document === 'undefined') {
      return;
    }
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  return { download };
}

export default useCsvExport;