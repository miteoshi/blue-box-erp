import {
    type RowResult,
    toBoolean,
    toNumber,
    toStringOrNull,
} from "./spreadsheet-import";

export interface ItemImportRow {
    item_code: string;
    name: string;
    category_id: string;
    sub_category: string | null;
    material_type_id: string;
    size_spec: string | null;
    unit_id: string | null;
    unit_name: string;
    hsn_code: string | null;
    is_traded: boolean;
    is_manufactured: boolean;
    is_raw_material: boolean;
    reorder_level: number;
    reorder_qty: number;
    notes: string | null;
}

// Expected columns:
// item_code, name, category, sub_category, material_type, size_spec, unit,
// hsn_code, is_traded, is_manufactured, is_raw_material, reorder_level,
// reorder_qty, notes

export function validateItemRow(
    raw: Record<string, unknown>,
    rowNumber: number,
    categories: { id: string; name: string }[],
    materialTypes: { id: string; name: string }[],
    units: { id: string; name: string }[],
): RowResult<ItemImportRow> {
    const errors: string[] = [];

    const item_code = String(raw.item_code ?? "").trim();

    if (!item_code) {
        errors.push("item_code is required");
    }

    const name = String(raw.name ?? "").trim();

    if (!name) {
        errors.push("name is required");
    }

    const categoryInput = String(raw.category ?? "").trim();

    const category = categories.find(
        (c) => c.name.toLowerCase() === categoryInput.toLowerCase(),
    );

    if (!category) {
        errors.push(
            `category must be one of: ${categories.map((c) => c.name).join(", ")}`,
        );
    }

    const materialInput = String(raw.material_type ?? "").trim();

    const materialType = materialTypes.find(
        (m) => m.name.toLowerCase() === materialInput.toLowerCase(),
    );

    if (!materialType) {
        errors.push(
            `material_type must be one of: ${materialTypes
                .map((m) => m.name)
                .join(", ")}`,
        );
    }

    const unitInput = String(raw.unit ?? "").trim();

    if (!unitInput) {
        errors.push("unit is required");
    }

    // Existing units are resolved here.
    // New units are allowed and will be created during import.
    const unit = units.find(
        (u) => u.name.toLowerCase() === unitInput.toLowerCase(),
    );

    const is_traded = toBoolean(raw.is_traded);
    const is_manufactured = toBoolean(raw.is_manufactured);
    const is_raw_material = toBoolean(raw.is_raw_material);

    if (!is_traded && !is_manufactured && !is_raw_material) {
        errors.push(
            "at least one of is_traded / is_manufactured / is_raw_material must be true",
        );
    }

    if (errors.length > 0 || !category || !materialType) {
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
            item_code,
            name,
            category_id: category.id,
            sub_category: toStringOrNull(raw.sub_category),
            material_type_id: materialType.id,
            size_spec: toStringOrNull(raw.size_spec),

            // Existing unit -> ID.
            // New unit -> null; created during import.
            unit_id: unit?.id ?? null,
            unit_name: unitInput,

            hsn_code: toStringOrNull(raw.hsn_code),
            is_traded,
            is_manufactured,
            is_raw_material,
            reorder_level: toNumber(raw.reorder_level, 0),
            reorder_qty: toNumber(raw.reorder_qty, 0),
            notes: toStringOrNull(raw.notes),
        },
    };
}