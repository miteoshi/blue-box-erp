import * as XLSX from "xlsx";

// Reads an .xlsx, .xls, or .csv file and returns its first sheet as an
// array of plain objects keyed by header row. Header names are trimmed
// and lowercased with spaces/hyphens converted to underscores, so
// "Item Code", "item-code", and "item_code" all map to the same key.
export async function parseSpreadsheet(
    file: File,
    sheetName?: string,
): Promise<Record<string, unknown>[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const selectedSheetName = sheetName ?? workbook.SheetNames[0];
    if (!selectedSheetName) return [];

    const sheet = workbook.Sheets[selectedSheetName];
    if (!sheet) return [];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false, // keep values as strings so we control coercion ourselves
    });

    return rawRows.map((row) => {
        const normalized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
            const normalizedKey = key.trim().toLowerCase().replace(
                /[\s-]+/g,
                "_",
            );
            normalized[normalizedKey] = typeof value === "string"
                ? value.trim()
                : value;
        }
        return normalized;
    });
}

// ── Shared coercion helpers used by both import validators ────────────────

export function toBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === "boolean") return value;
    const s = String(value ?? "").trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
    return fallback;
}

export function toNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number") return value;
    const n = Number(String(value ?? "").trim());
    return Number.isFinite(n) ? n : fallback;
}

export function toStringOrNull(value: unknown): string | null {
    const s = String(value ?? "").trim();
    return s.length > 0 ? s : null;
}

// A single row's validation outcome, used to drive the preview table.
export interface RowResult<T> {
    rowNumber: number; // 1-based, matches the spreadsheet row (header = row 1)
    raw: Record<string, unknown>;
    data: T | null; // present only if errors is empty
    errors: string[];
}
