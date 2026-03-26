export interface OzonRowPreview {
  article: string;
  name: string;
  brand?: string | null;
  kit?: string | null;
  annotation?: string | null;
  availableExtraColumns: string[];
  rawRow: Record<string, unknown>;
}

export interface ParsedOzonWorkbook {
  headers: string[];
  rows: Record<string, unknown>[];
}
