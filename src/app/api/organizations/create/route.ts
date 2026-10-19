import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ORGANIZATION_TEMPLATES } from "@/lib/organization-templates";
import * as XLSX from "xlsx";
import fs from "fs/promises";
import path from "path";

type TemplateCategory = {
  code: string;
  name: string;
  description: string;
};

type TemplateMaterialType = {
  code: string;
  name: string;
  description: string;
};

type TemplateUnit = {
  code: string;
  name: string;
  description: string;
};

export async function GET() {
  return NextResponse.json({
    templates: Object.entries(ORGANIZATION_TEMPLATES).map(
      ([id, config]) => ({
        id,
        name: config.name,
      })
    ),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();

    const orgName = String(body.orgName ?? "").trim();

    const template = body.template
      ? String(body.template).trim()
      : null;

    const includeSapDefaults = body.includeSapDefaults === true;

    if (!orgName) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 }
      );
    }

    let categories: TemplateCategory[] = [];
    let materialTypes: TemplateMaterialType[] = [];
    let units: TemplateUnit[] = [];

    /*
     * Load SAP global defaults first.
     *
     * These are independent of the selected organization template.
     */
    if (includeSapDefaults) {
      const sapPath = path.join(
        process.cwd(),
        "public",
        "templates",
        "sap-global-defaults.xlsx"
      );

      const fileBuffer = await fs.readFile(sapPath);

      const workbook = XLSX.read(fileBuffer, {
        type: "buffer",
      });

      const categoriesSheet = workbook.Sheets["Categories"];
      const materialTypesSheet = workbook.Sheets["Material Types"];
      const unitsSheet = workbook.Sheets["Units"];

      if (!materialTypesSheet || !unitsSheet) {
        return NextResponse.json(
          { error: "Invalid SAP global defaults template" },
          { status: 400 }
        );
      }

      if (categoriesSheet) {
        categories = XLSX.utils.sheet_to_json<TemplateCategory>(
          categoriesSheet,
          {
            defval: "",
          }
        );
      }

      materialTypes = XLSX.utils.sheet_to_json<TemplateMaterialType>(
        materialTypesSheet,
        {
          defval: "",
        }
      );

      units = XLSX.utils.sheet_to_json<TemplateUnit>(unitsSheet, {
        defval: "",
      });
    }

    /*
     * Load the selected organization template.
     *
     * Template data is added on top of SAP defaults.
     */
    if (template) {
      const templateConfig =
        ORGANIZATION_TEMPLATES[
          template as keyof typeof ORGANIZATION_TEMPLATES
        ];

      if (!templateConfig) {
        return NextResponse.json(
          { error: "Unknown organization template" },
          { status: 400 }
        );
      }

      const templatePath = path.join(
        process.cwd(),
        "public",
        "templates",
        templateConfig.file
      );

      const fileBuffer = await fs.readFile(templatePath);

      const workbook = XLSX.read(fileBuffer, {
        type: "buffer",
      });

      const categoriesSheet = workbook.Sheets["Categories"];
      const materialTypesSheet = workbook.Sheets["Material Types"];

      if (!categoriesSheet || !materialTypesSheet) {
        return NextResponse.json(
          { error: "Invalid organization template" },
          { status: 400 }
        );
      }

      const templateCategories =
        XLSX.utils.sheet_to_json<TemplateCategory>(
          categoriesSheet,
          {
            defval: "",
          }
        );

      const templateMaterialTypes =
        XLSX.utils.sheet_to_json<TemplateMaterialType>(
          materialTypesSheet,
          {
            defval: "",
          }
        );

      categories = [
        ...categories,
        ...templateCategories,
      ];

      materialTypes = [
        ...materialTypes,
        ...templateMaterialTypes,
      ];
    }

    const { data: orgId, error } = await supabase.rpc(
      "create_organization",
      {
        p_name: orgName,
        p_template: template ?? undefined,
        p_categories: categories,
        p_material_types: materialTypes,
        p_units: units,
        p_include_sap_defaults: includeSapDefaults,
      }
    );

    if (error) {
      throw error;
    }

    return NextResponse.json({
      orgId,
    });
  } catch (error: unknown) {
    console.error("Organization creation failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create organization";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
