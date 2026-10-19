"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOrgId } from "@/lib/hooks/use-tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  parseSpreadsheet,
  type RowResult,
} from "@/lib/utils/spreadsheet-import";
import { validateItemRow, type ItemImportRow } from "@/lib/utils/item-import";
import { toast } from "sonner";
import { Upload, CheckCircle2, XCircle, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function ImportItemsPage() {
  const router = useRouter();
  const supabase = createClient();
  const orgId = useOrgId();

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["item-categories", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("item_categories")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const { data: materialTypes = [], isLoading: materialTypesLoading } =
    useQuery({
      queryKey: ["material-types", orgId],
      queryFn: async () => {
        if (!orgId) return [];

        const { data, error } = await supabase
          .from("material_types")
          .select("id, code, name")
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return data;
      },
      enabled: !!orgId,
    });

  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ["units", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("units")
        .select("id, code, name, is_active")
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const [rows, setRows] = useState<RowResult<ItemImportRow>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  async function handleFile(file: File) {
    if (categoriesLoading || materialTypesLoading || unitsLoading) {
      toast.error("Categories, material types, or units are still loading");
      return;
    }

    if (categories.length === 0) {
      toast.error("No active item categories found for this organization");
      return;
    }

    if (materialTypes.length === 0) {
      toast.error("No active material types found for this organization");
      return;
    }

    setParsing(true);
    setFileName(file.name);

    try {
      const parsed = await parseSpreadsheet(file, "Item Import");

      if (parsed.length === 0) {
        toast.error("No rows found in that file");
        setRows([]);
        return;
      }

      const results = parsed.map((raw, i) =>
        validateItemRow(raw, i + 2, categories, materialTypes, units)
      );

      setRows(results);
    } catch (err) {
      toast.error("Could not read that file — is it a valid .xlsx or .csv?");
      console.error(err);
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      /*
       * Load every unit for this organization.
       *
       * We intentionally do NOT filter by is_active here because:
       * - an imported unit may already exist but be inactive
       * - in that case we can reactivate and reuse it
       */
      const { data: existingUnits, error: unitsError } = await supabase
        .from("units")
        .select("id, code, name, is_active")
        .eq("org_id", orgId);

      if (unitsError) throw unitsError;

      const unitsByName = new Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          is_active: boolean;
        }
      >();

      const unitsByCode = new Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          is_active: boolean;
        }
      >();

      for (const unit of existingUnits ?? []) {
        unitsByName.set(unit.name.trim().toLowerCase(), unit);
        unitsByCode.set(unit.code.trim().toLowerCase(), unit);
      }

      const resolvedRows = [];

      for (const row of validRows) {
        const data = row.data!;

        const unitName = data.unit_name.trim();
        const unitNameKey = unitName.toLowerCase();

        let unit = unitsByName.get(unitNameKey);

        /*
         * Existing unit:
         * reuse it.
         *
         * If it was inactive, reactivate it because the imported item
         * is now actively using that unit.
         */
        if (unit) {
          if (!unit.is_active) {
            const { data: reactivatedUnit, error } = await supabase
              .from("units")
              .update({ is_active: true })
              .eq("id", unit.id)
              .eq("org_id", orgId)
              .select("id, code, name, is_active")
              .single();

            if (error) throw error;

            unit = reactivatedUnit;

            unitsByName.set(unitNameKey, unit);
            unitsByCode.set(unit.code.trim().toLowerCase(), unit);
          }
        } else {
          /*
           * New unit.
           *
           * Generate an internal code from the unit name.
           * Example:
           *   "Meter"      -> "METER"
           *   "Square M"   -> "SQUARE_M"
           *   "TO/MT"      -> "TO_MT"
           */
          const baseCode =
            unitName
              .toUpperCase()
              .replace(/\s+/g, "_")
              .replace(/[^A-Z0-9_]/g, "") || "UNIT";

          let unitCode = baseCode;
          let suffix = 2;

          while (unitsByCode.has(unitCode.toLowerCase())) {
            unitCode = `${baseCode}_${suffix}`;
            suffix++;
          }

          const { data: newUnit, error: createUnitError } = await supabase
            .from("units")
            .insert({
              org_id: orgId,
              code: unitCode,
              name: unitName,
              description: unitName,
              is_active: true,
            })
            .select("id, code, name, is_active")
            .single();

          if (createUnitError) throw createUnitError;

          unit = newUnit;

          unitsByName.set(unitNameKey, unit);
          unitsByCode.set(unit.code.trim().toLowerCase(), unit);
        }

        resolvedRows.push({
          item_code: data.item_code,
          name: data.name,
          category_id: data.category_id,
          sub_category: data.sub_category,
          material_type_id: data.material_type_id,
          size_spec: data.size_spec,
          unit_id: unit.id,
          hsn_code: data.hsn_code,
          is_traded: data.is_traded,
          is_manufactured: data.is_manufactured,
          is_raw_material: data.is_raw_material,
          reorder_level: data.reorder_level,
          reorder_qty: data.reorder_qty,
          notes: data.notes,
          org_id: orgId,
          created_by: user?.id ?? null,
        });
      }

      /*
       * Upsert on (org_id, item_code).
       *
       * Re-importing the same item code updates the existing item
       * instead of creating a duplicate.
       */
      const { error } = await supabase.from("items").upsert(resolvedRows, {
        onConflict: "org_id,item_code",
      });

      if (error) throw error;

      toast.success(
        `Imported ${validRows.length} item${validRows.length !== 1 ? "s" : ""}`
      );

      router.push("/items");
    } catch (err: unknown) {
  console.error("ITEM IMPORT FAILED:", err)

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err)

  toast.error(`Import failed: ${message}`)
}  finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Import Items"
        description="Bulk-add or update items from an Excel or CSV file"
      >
        <a
          href="/api/items/template"
          download
          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Download Template
        </a>

        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>

        {validRows.length > 0 && (
          <Button size="sm" loading={saving} onClick={handleImport}>
            <Save className="w-4 h-4" />
            Import {validRows.length} item
            {validRows.length !== 1 ? "s" : ""}
          </Button>
        )}
      </PageHeader>

      <Card className="mb-6">
        <CardBody>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-lg py-10 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
            <Upload className="w-6 h-6 text-slate-400" />

            <span className="text-sm text-slate-600">
              {fileName ?? "Click to choose a .xlsx, .xls, or .csv file"}
            </span>

            <span className="text-xs text-slate-400">
              Columns: item_code, name, category, sub_category, material_type,
              size_spec, unit, hsn_code, is_traded, is_manufactured,
              is_raw_material, reorder_level, reorder_qty, notes
            </span>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];

                if (file) {
                  handleFile(file);
                }
              }}
            />
          </label>
        </CardBody>
      </Card>

      {parsing && <p className="text-sm text-slate-500">Reading file…</p>}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                {validRows.length} valid
              </span>

              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1.5 text-red-600 font-medium">
                  <XCircle className="w-4 h-4" />
                  {invalidRows.length} with errors
                </span>
              )}
            </div>
          </CardHeader>

          <CardBody className="p-0">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Row
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Item Code
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Name
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Category
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Unit
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Issues
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {rows.map((r) => (
                    <tr
                      key={r.rowNumber}
                      className={r.errors.length > 0 ? "bg-red-50/50" : ""}
                    >
                      <td className="px-3 py-2 text-slate-400">
                        {r.rowNumber}
                      </td>

                      <td className="px-3 py-2 font-medium text-slate-700">
                        {String(r.raw.item_code ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-slate-600">
                        {String(r.raw.name ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-slate-600">
                        {String(r.raw.category ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-slate-600">
                        {String(r.raw.unit ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-red-600">
                        {r.errors.length > 0 ? (
                          r.errors.join("; ")
                        ) : (
                          <span className="text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
