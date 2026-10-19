"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";

interface ItemActionsProps {
  item: any;
  stockQty: number;
}

interface Option {
  id: string;
  name: string;
}

type FormState = {
  name: string;
  category_id: string;
  sub_category: string;
  material_type_id: string;
  size_spec: string;
  unit_id: string;
  hsn_code: string;
  is_traded: boolean;
  is_manufactured: boolean;
  is_raw_material: boolean;
  reorder_level: string;
  reorder_qty: string;
  notes: string;
};

type ReferenceColumn = "component_id" | "finished_item_id" | "item_id";

type ReferenceCheck = {
  table:
    | "bom"
    | "item_prices"
    | "inventory_balance"
    | "inventory_ops_log"
    | "stock_movements"
    | "stock_reservations"
    | "inbound_receipt_lines"
    | "delivery_challan_lines"
    | "quotation_lines"
    | "sales_order_lines"
    | "production_order_items";
  label: string;
  column: ReferenceColumn;
  selectColumn: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100";

function errorMessage(error: any, fallback: string) {
  const message = String(error?.message ?? "");
  const code = error?.code;

  if (code === "23505") {
    return "Cannot save item: this item code already exists in your organization.";
  }

  if (code === "23503") {
    return `Cannot save item: ${message}`;
  }

  return message || fallback;
}

function deleteErrorMessage(error: any) {
  const message = String(error?.message ?? "");
  const detail = String(error?.details ?? "");
  const hint = String(error?.hint ?? "");
  const combined = `${message} ${detail} ${hint}`.toLowerCase();

  if (error?.code === "23503" || combined.includes("foreign key")) {
    if (combined.includes("bom")) {
      return "Cannot delete item: it is referenced by a BOM.";
    }

    if (combined.includes("item_prices")) {
      return "Cannot delete item: it has price history records.";
    }

    if (combined.includes("inventory_balance")) {
      return "Cannot delete item: it has an inventory balance record.";
    }

    if (combined.includes("inventory_ops_log")) {
      return "Cannot delete item: it has inventory operation records.";
    }

    if (combined.includes("stock_movements")) {
      return "Cannot delete item: it has stock movement history.";
    }

    if (combined.includes("stock_reservations")) {
      return "Cannot delete item: it has stock reservation records.";
    }

    if (combined.includes("inbound_receipt_lines")) {
      return "Cannot delete item: it is referenced by inbound receipt lines.";
    }

    if (combined.includes("delivery_challan_lines")) {
      return "Cannot delete item: it is referenced by delivery challan lines.";
    }

    if (combined.includes("quotation_lines")) {
      return "Cannot delete item: it is referenced by quotation lines.";
    }

    if (combined.includes("sales_order_lines")) {
      return "Cannot delete item: it is referenced by sales order lines.";
    }

    if (combined.includes("production_order_items")) {
      return "Cannot delete item: it is referenced by production order items.";
    }

    return "Cannot delete item because another record references it.";
  }

  return message || "Cannot delete item.";
}

export default function ItemActions({ item, stockQty }: ItemActionsProps) {
  const supabase = createClient();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [categories, setCategories] = useState<Option[]>([]);
  const [materialTypes, setMaterialTypes] = useState<Option[]>([]);
  const [units, setUnits] = useState<Option[]>([]);

  const [form, setForm] = useState<FormState>({
    name: item.name ?? "",
    category_id: item.category_id ?? "",
    sub_category: item.sub_category ?? "",
    material_type_id: item.material_type_id ?? "",
    size_spec: item.size_spec ?? "",
    unit_id: item.unit_id ?? "",
    hsn_code: item.hsn_code ?? "",
    is_traded: !!item.is_traded,
    is_manufactured: !!item.is_manufactured,
    is_raw_material: !!item.is_raw_material,
    reorder_level: item.reorder_level == null ? "" : String(item.reorder_level),
    reorder_qty: item.reorder_qty == null ? "" : String(item.reorder_qty),
    notes: item.notes ?? "",
  });

  useEffect(() => {
    if (!editing) return;

    let cancelled = false;

    async function loadOptions() {
      const [categoryResult, materialResult, unitResult] = await Promise.all([
        supabase
          .from("item_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),

        supabase
          .from("material_types")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),

        supabase
          .from("units")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
      ]);

      if (cancelled) return;

      if (categoryResult.error) {
        toast.error(
          `Could not load categories: ${categoryResult.error.message}`
        );
        return;
      }

      if (materialResult.error) {
        toast.error(
          `Could not load material types: ${materialResult.error.message}`
        );
        return;
      }

      if (unitResult.error) {
        toast.error(`Could not load units: ${unitResult.error.message}`);
        return;
      }

      setCategories(categoryResult.data ?? []);
      setMaterialTypes(materialResult.data ?? []);
      setUnits(unitResult.data ?? []);
    }

    loadOptions();

    return () => {
      cancelled = true;
    };
  }, [editing]);

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function openEdit() {
    setForm({
      name: item.name ?? "",
      category_id: item.category_id ?? "",
      sub_category: item.sub_category ?? "",
      material_type_id: item.material_type_id ?? "",
      size_spec: item.size_spec ?? "",
      unit_id: item.unit_id ?? "",
      hsn_code: item.hsn_code ?? "",
      is_traded: !!item.is_traded,
      is_manufactured: !!item.is_manufactured,
      is_raw_material: !!item.is_raw_material,
      reorder_level:
        item.reorder_level == null ? "" : String(item.reorder_level),
      reorder_qty: item.reorder_qty == null ? "" : String(item.reorder_qty),
      notes: item.notes ?? "",
    });

    setEditing(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Item name is required.");
      return;
    }

    if (!form.category_id) {
      toast.error("Category is required.");
      return;
    }

    if (!form.material_type_id) {
      toast.error("Material type is required.");
      return;
    }

    if (!form.unit_id) {
      toast.error("Unit is required.");
      return;
    }

    if (!form.is_traded && !form.is_manufactured && !form.is_raw_material) {
      toast.error("Select at least one item type.");
      return;
    }

    const reorderLevel =
      form.reorder_level === "" ? null : Number(form.reorder_level);

    const reorderQty =
      form.reorder_qty === "" ? null : Number(form.reorder_qty);

    if (reorderLevel !== null && !Number.isFinite(reorderLevel)) {
      toast.error("Reorder level must be a valid number.");
      return;
    }

    if (reorderQty !== null && !Number.isFinite(reorderQty)) {
      toast.error("Reorder quantity must be a valid number.");
      return;
    }

    if (reorderLevel !== null && reorderLevel < 0) {
      toast.error("Reorder level cannot be negative.");
      return;
    }

    if (reorderQty !== null && reorderQty < 0) {
      toast.error("Reorder quantity cannot be negative.");
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from("items")
        .update({
          name: form.name.trim(),
          category_id: form.category_id,
          sub_category: form.sub_category.trim() || null,
          material_type_id: form.material_type_id,
          size_spec: form.size_spec.trim() || null,
          unit_id: form.unit_id,
          hsn_code: form.hsn_code.trim() || null,
          is_traded: form.is_traded,
          is_manufactured: form.is_manufactured,
          is_raw_material: form.is_raw_material,
          reorder_level: reorderLevel,
          reorder_qty: reorderQty,
          notes: form.notes.trim() || null,
        })
        .eq("id", item.id);

      if (error) {
        throw error;
      }

      toast.success("Item updated successfully.");
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Could not update item."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;

    if (
      !window.confirm(
        `Delete item ${item.item_code} — ${item.name}? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeleting(true);

    try {
      /*
       * Check the live inventory balance immediately before deletion.
       * Do not rely only on the stockQty prop because it may be stale.
       */
      const { data: balance, error: balanceError } = await supabase
        .from("inventory_balance")
        .select("current_qty")
        .eq("item_id", item.id)
        .maybeSingle();

      if (balanceError) {
        throw balanceError;
      }

      const currentQty = Number(balance?.current_qty ?? 0);

      if (!Number.isFinite(currentQty)) {
        throw new Error("Could not determine the current inventory quantity.");
      }

      if (currentQty !== 0) {
        toast.error(
          `Cannot delete item: current on-hand quantity is ${currentQty}. Quantity must be 0.`
        );
        return;
      }

      /*
       * Every selectColumn below is a real column in the corresponding
       * table. These queries only need a valid column so Supabase can
       * return an exact count without fetching rows.
       */
      const checks: ReferenceCheck[] = [
        {
          table: "bom",
          label: "BOM records",
          column: "finished_item_id",
          selectColumn: "id",
        },
        {
          table: "bom",
          label: "BOM component references",
          column: "component_id",
          selectColumn: "id",
        },
        {
          table: "item_prices",
          label: "price history records",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "inventory_balance",
          label: "inventory balance records",
          column: "item_id",
          selectColumn: "item_id",
        },
        {
          table: "inventory_ops_log",
          label: "inventory operation records",
          column: "item_id",
          selectColumn: "operation_id",
        },
        {
          table: "stock_movements",
          label: "stock movement records",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "stock_reservations",
          label: "stock reservation records",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "inbound_receipt_lines",
          label: "inbound receipt lines",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "delivery_challan_lines",
          label: "delivery challan lines",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "quotation_lines",
          label: "quotation lines",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "sales_order_lines",
          label: "sales order lines",
          column: "item_id",
          selectColumn: "id",
        },
        {
          table: "production_order_items",
          label: "production order items",
          column: "item_id",
          selectColumn: "id",
        },
      ];

      const results = await Promise.all(
        checks.map(async (check) => ({
          ...check,
          result: await supabase
            .from(check.table)
            .select(check.selectColumn, {
              count: "exact",
              head: true,
            })
            .eq(check.column as any, item.id),
        }))
      );

      const failedCheck = results.find(({ result }) => result.error);

      if (failedCheck) {
        throw new Error(
          `Could not verify ${failedCheck.label}: ${failedCheck.result.error?.message}`
        );
      }

      const references = results
        .filter(({ result }) => (result.count ?? 0) > 0)
        .map(({ label, result }) => `${result.count} ${label}`);

      if (references.length > 0) {
        toast.error(
          `Cannot delete item: ${references.join(", ")} reference this item.`
        );
        return;
      }

      /*
       * The checks above are for a friendly user-facing message.
       * PostgreSQL foreign keys remain the final protection against
       * deleting an item that becomes referenced concurrently.
       */
      const { error: deleteError } = await supabase
        .from("items")
        .delete()
        .eq("id", item.id);

      if (deleteError) {
        throw deleteError;
      }

      toast.success("Item deleted successfully.");
      router.push("/items");
      router.refresh();
    } catch (error) {
      toast.error(deleteErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={openEdit}>
          <Pencil className="w-4 h-4 mr-1" />
          Edit Item
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          className="text-red-600 border-red-200 hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          {deleting ? "Deleting..." : "Delete Item"}
        </Button>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Edit Item
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Item code cannot be changed. All other editable item properties
                can be updated.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-5">
              <Field label="Item Code">
                <input
                  value={item.item_code ?? ""}
                  disabled
                  className={inputClass}
                />
              </Field>

              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <Field label="Category">
                <select
                  value={form.category_id}
                  onChange={(e) => setField("category_id", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">Select category</option>

                  {categories.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Material Type">
                <select
                  value={form.material_type_id}
                  onChange={(e) => setField("material_type_id", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">Select material type</option>

                  {materialTypes.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Sub-Category">
                <input
                  value={form.sub_category}
                  onChange={(e) => setField("sub_category", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <Field label="Size / Spec">
                <input
                  value={form.size_spec}
                  onChange={(e) => setField("size_spec", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <Field label="Unit">
                <select
                  value={form.unit_id}
                  onChange={(e) => setField("unit_id", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">Select unit</option>

                  {units.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="HSN Code">
                <input
                  value={form.hsn_code}
                  onChange={(e) => setField("hsn_code", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <Field label="Reorder Level">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.reorder_level}
                  onChange={(e) => setField("reorder_level", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <Field label="Reorder Quantity">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.reorder_qty}
                  onChange={(e) => setField("reorder_qty", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </Field>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Type
                </label>

                <div className="flex flex-wrap gap-4">
                  <Check
                    label="Traded"
                    checked={form.is_traded}
                    onChange={(v) => setField("is_traded", v)}
                    disabled={saving}
                  />

                  <Check
                    label="Manufactured"
                    checked={form.is_manufactured}
                    onChange={(v) => setField("is_manufactured", v)}
                    disabled={saving}
                  />

                  <Check
                    label="Raw Material"
                    checked={form.is_raw_material}
                    onChange={(v) => setField("is_raw_material", v)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Notes
                </label>

                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  disabled={saving}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>

              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>

      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />

      {label}
    </label>
  );
}
