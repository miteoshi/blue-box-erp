import {
    type RowResult,
    toNumber,
    toStringOrNull,
} from "./spreadsheet-import";

export interface BomImportRow {
    finished_item_id: string;
    component_id: string;
    qty_per_unit: number;
    unit_id: string | null;
    unit_name: string;
    notes: string | null;
}

export function validateBomRow(
    raw: Record<string, unknown>,
    rowNumber: number,
    itemsByCode: Map<string, string>,
    unitsByName: Map<string, string>,
): RowResult<BomImportRow> {
    const errors: string[] = [];

    const finishedCode = String(
        raw.finished_item_code ?? "",
    )
        .trim()
        .toUpperCase();

    const componentCode = String(
        raw.component_item_code ?? "",
    )
        .trim()
        .toUpperCase();

    if (!finishedCode) {
        errors.push("finished_item_code is required");
    }

    if (!componentCode) {
        errors.push("component_item_code is required");
    }

    const finished_item_id = itemsByCode.get(finishedCode);

    if (finishedCode && !finished_item_id) {
        errors.push(
            `no item found with code "${finishedCode}" in this organization`,
        );
    }

    const component_id = itemsByCode.get(componentCode);

    if (componentCode && !component_id) {
        errors.push(
            `no item found with code "${componentCode}" in this organization`,
        );
    }

    if (
        finishedCode &&
        componentCode &&
        finishedCode === componentCode
    ) {
        errors.push(
            "finished_item_code and component_item_code cannot be the same item",
        );
    }

    const qty_per_unit = toNumber(raw.qty_per_unit, 0);

    if (qty_per_unit <= 0) {
        errors.push("qty_per_unit must be greater than 0");
    }

    const unitInput = String(raw.unit ?? "").trim();

    if (!unitInput) {
        errors.push("unit is required");
    }

    /*
     * Existing unit:
     * resolve it now.
     *
     * New unit:
     * leave unit_id null and create it during import.
     */
    const unit_id = unitsByName.get(unitInput.toLowerCase());

    if (
        errors.length > 0 ||
        !finished_item_id ||
        !component_id
    ) {
        return {
            rowNumber,
            raw,
            data: null,
            errors,
        };
    }

    return {
        rowNumber,
        raw,
        errors: [],
        data: {
            finished_item_id,
            component_id,
            qty_per_unit,
            unit_id: unit_id ?? null,
            unit_name: unitInput,
            notes: toStringOrNull(raw.notes),
        },
    };
}