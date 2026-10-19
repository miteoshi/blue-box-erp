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
import { validateBomRow, type BomImportRow } from "@/lib/utils/bom-import";
import { toast } from "sonner";
import { Upload, CheckCircle2, XCircle, Save } from "lucide-react";

export default function ImportBomPage() {
  const router = useRouter();
  const supabase = createClient();
  const orgId = useOrgId();

  const [rows, setRows] = useState<RowResult<BomImportRow>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  const validRows = rows.filter((r) => r.errors.length === 0);

  const invalidRows = rows.filter((r) => r.errors.length > 0);

  async function handleFile(file: File) {
    if (!orgId) {
      toast.error("Organization not loaded yet — try again in a moment");
      return;
    }

    setParsing(true);
    setFileName(file.name);

    try {
      /*
       * Load this organization's items.
       */
      const { data: items, error: itemsError } = await supabase
        .from("items")
        .select("id, item_code")
        .eq("org_id", orgId);

      if (itemsError) {
        throw itemsError;
      }

      const itemsByCode = new Map(
        (items ?? []).map((item) => [
          item.item_code.trim().toUpperCase(),
          item.id,
        ])
      );

      /*
       * Load ALL units, including inactive ones.
       *
       * We do this because an imported BOM may reference an
       * existing inactive unit. The import will reactivate it.
       */
      const { data: units, error: unitsError } = await supabase
        .from("units")
        .select("id, code, name, is_active")
        .eq("org_id", orgId)
        .order("name");

      if (unitsError) {
        throw unitsError;
      }

      const unitsByName = new Map(
        (units ?? []).map((unit) => [unit.name.trim().toLowerCase(), unit.id])
      );

      /*
       * Excel template uses "BOM Import".
       *
       * CSV has no worksheet, so let the parser use its
       * first/default sheet for CSV files.
       */
      const isCsv = file.name.toLowerCase().endsWith(".csv");

      const parsed = await parseSpreadsheet(
        file,
        isCsv ? undefined : "BOM Import"
      );

      if (parsed.length === 0) {
        toast.error(
          "No rows found. Make sure the Excel file contains data on the 'BOM Import' sheet."
        );
        setRows([]);
        return;
      }

      /*
       * First validate each row.
       */
      const results = parsed.map((raw, i) =>
        validateBomRow(raw, i + 2, itemsByCode, unitsByName)
      );

      /*
       * Detect duplicate BOM pairs inside the same spreadsheet.
       *
       * PostgreSQL has a unique constraint on:
       *
       * finished_item_id + component_id
       *
       * Therefore two identical pairs in one import cannot both
       * be inserted.
       */
      const seenPairs = new Map<string, number>();

      for (const result of results) {
        if (!result.data) {
          continue;
        }

        const pairKey = `${result.data.finished_item_id}:${result.data.component_id}`;

        const previousRow = seenPairs.get(pairKey);

        if (previousRow !== undefined) {
          result.errors.push(
            `duplicate BOM pair — same finished item and component already appear on row ${previousRow}`
          );
          result.data = null;
        } else {
          seenPairs.set(pairKey, result.rowNumber);
        }
      }

      setRows(results);
    } catch (err) {
      console.error("BOM FILE PARSE FAILED:", err);

      toast.error(
        err instanceof Error ? err.message : "Could not read that file"
      );
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
       * Load every unit again immediately before import.
       *
       * This prevents the preview from becoming stale if a unit
       * was created/changed after the file was loaded.
       */
      const { data: existingUnits, error: unitsError } = await supabase
        .from("units")
        .select("id, code, name, is_active")
        .eq("org_id", orgId);

      if (unitsError) {
        throw unitsError;
      }

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

      const payload = [];

      for (const row of validRows) {
        const data = row.data!;

        const unitName = data.unit_name.trim();
        const unitNameKey = unitName.toLowerCase();

        let unit = unitsByName.get(unitNameKey);

        /*
         * Existing unit.
         */
        if (unit) {
          /*
           * If it was inactive, reactivate it because this BOM
           * is actively using it.
           */
          if (!unit.is_active) {
            const { data: reactivatedUnit, error: reactivateError } =
              await supabase
                .from("units")
                .update({
                  is_active: true,
                })
                .eq("org_id", orgId)
                .eq("id", unit.id)
                .select("id, code, name, is_active")
                .single();

            if (reactivateError) {
              throw reactivateError;
            }

            unit = reactivatedUnit;

            unitsByName.set(unitNameKey, unit);

            unitsByCode.set(unit.code.trim().toLowerCase(), unit);
          }
        } else {
          /*
           * New unit.
           *
           * Generate an internal code from the unit name.
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

          if (createUnitError) {
            throw createUnitError;
          }

          unit = newUnit;

          unitsByName.set(unitNameKey, unit);

          unitsByCode.set(unit.code.trim().toLowerCase(), unit);
        }

        payload.push({
          finished_item_id: data.finished_item_id,

          component_id: data.component_id,

          qty_per_unit: data.qty_per_unit,

          unit_id: unit.id,

          notes: data.notes,

          org_id: orgId,

          created_by: user?.id ?? null,
        });
      }

      /*
       * Insert/update each BOM row.
       *
       * We intentionally do this one row at a time rather than
       * sending duplicate conflict keys in one PostgreSQL upsert.
       */
      for (const bomRow of payload) {
        const { error: bomError } = await supabase.from("bom").upsert(bomRow, {
          onConflict: "finished_item_id,component_id",
        });

        if (bomError) {
          throw bomError;
        }
      }

      toast.success(
        `Imported ${validRows.length} BOM line${
          validRows.length !== 1 ? "s" : ""
        }`
      );

      router.push("/items");
    } catch (err: unknown) {
      console.error("BOM IMPORT FAILED:", err);

      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String(
              (
                err as {
                  message?: unknown;
                }
              ).message
            )
          : String(err);

      toast.error(`Import failed: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Import Bill of Materials"
        description="Bulk-add BOM lines by referencing items by their item code"
      >
        <a
          href="/templates/bom-import-template.xlsx"
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
            Import {validRows.length} line
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
              Columns: finished_item_code, component_item_code, qty_per_unit,
              unit, notes — codes must already exist in Items
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

      {parsing && (
        <p className="text-sm text-slate-500">
          Reading file and matching item codes…
        </p>
      )}

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
                      Finished Item
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Component
                    </th>

                    <th className="text-left px-3 py-2 font-semibold text-slate-500">
                      Qty/Unit
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
                        {String(r.raw.finished_item_code ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-slate-600">
                        {String(r.raw.component_item_code ?? "—")}
                      </td>

                      <td className="px-3 py-2 text-slate-600">
                        {String(r.raw.qty_per_unit ?? "—")}
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
