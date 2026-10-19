import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.org_id) {
      return NextResponse.json(
        { error: "User is not associated with an organization" },
        { status: 403 }
      );
    }

    const { data: materialTypes, error: materialTypesError } = await supabase
      .from("material_types")
      .select("code, name")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("name");


    const { data: categories, error: categoriesError } = await supabase
        .from("item_categories")
        .select("code, name")
        .eq("org_id", profile.org_id)
        .eq("is_active", true)
        .order("name");

    if (categoriesError) {
    throw categoriesError;
    }

    if (materialTypesError) {
      throw materialTypesError;
    }

    const instructions = [
      ["ITEM IMPORT TEMPLATE"],
      [],
      ["Upload this workbook through the Item Import page."],
      [],
      ["Required fields"],
      ["item_code", "Unique item code."],
      ["name", "Item name."],
      ["category", "Must be an active category in your organization."],
      ["material_type", "Must match an active material type in your organization."],
      ["unit", "Required unit."],
    ];

    const itemImport = [
      [
        "item_code",
        "name",
        "category",
        "sub_category",
        "material_type",
        "size_spec",
        "unit",
        "hsn_code",
        "is_traded",
        "is_manufactured",
        "is_raw_material",
        "reorder_level",
        "reorder_qty",
        "notes",
      ],
    ];

    const allowedValues = [
    ["Categories", "Category Code", "", "Material Types", "Code"],
    ...Array.from(
        {
        length: Math.max(
            categories?.length ?? 0,
            materialTypes?.length ?? 0
        ),
        },
        (_, i) => [
        categories?.[i]?.name ?? "",
        categories?.[i]?.code ?? "",
        "",
        materialTypes?.[i]?.name ?? "",
        materialTypes?.[i]?.code ?? "",
        ]
    ),
    ];

    const itemImportSheet = XLSX.utils.aoa_to_sheet(itemImport);

    itemImportSheet["!dataValidation"] = [
    {
        sqref: "E2:E1000",
        type: "list",
        formulas: ['\'Allowed Values\'!$A$2:$A$1000'],
    },
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(instructions),
      "Instructions"
    );

    XLSX.utils.book_append_sheet(
        workbook,
        itemImportSheet,
        "Item Import"
        );

    const allowedValuesSheet = XLSX.utils.aoa_to_sheet(allowedValues);


    XLSX.utils.book_append_sheet(
    workbook,
    allowedValuesSheet,
    "Allowed Values"
    );

    const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    });

    const zip = await JSZip.loadAsync(buffer);

    const sheetXml = await zip.file("xl/worksheets/sheet2.xml")!.async("string");

    const validationXml = `
    <dataValidations count="2">
    <dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="C2:C1000">
        <formula1>'Allowed Values'!$A$2:$A$1000</formula1>
    </dataValidation>
    <dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="E2:E1000">
        <formula1>'Allowed Values'!$D$2:$D$1000</formula1>
    </dataValidation>
    </dataValidations>`;

    const patchedSheetXml = sheetXml.replace(
    "<ignoredErrors>",
    `${validationXml}<ignoredErrors>`
    );

    zip.file("xl/worksheets/sheet2.xml", patchedSheetXml);

    const finalBuffer = await zip.generateAsync({
    type: "nodebuffer",
    });

    return new NextResponse(new Uint8Array(finalBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="item-import-template.xlsx"',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generate template",
      },
      { status: 500 }
    );
  }
}