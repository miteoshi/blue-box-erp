"use client";

import { useState } from "react";
import { useOrgId } from "@/lib/hooks/use-tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TableLoader } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/utils/format";
import { Search } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useItemCategories } from "@/lib/hooks/use-items";

// Fetch items with their current prices joined
function useItemsWithPrices(
  search: string,
  categoryId: string,
  orgId: string | null
) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["items-with-prices", orgId, search, categoryId],

    queryFn: async () => {
      if (!orgId) return [];

      let query = supabase
        .from("items")
        .select(
          `
          id,
          item_code,
          name,
          category_id,
          sub_category,
          material_type_id,

          material_type:material_types (
            id,
            name
          ),

          unit_id,

          unit:units (
            id,
            name
          ),

          size_spec,
          hsn_code,
          is_traded,
          is_manufactured,
          is_raw_material,
          reorder_level,
          is_active
          `
        )
        .eq("is_active", true)
        .order("category_id")
        .order("item_code");

      if (categoryId) {
        query = query.eq("category_id", categoryId);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,item_code.ilike.%${search}%`);
      }

      const { data: items, error } = await query;

      if (error) throw error;

      const { data: prices } = await supabase
        .from("v_current_prices")
        .select("item_id, purchase_rate, selling_rate, gst_percent, rate_unit");

      const priceMap = new Map(prices?.map((p) => [p.item_id, p]) ?? []);

      return (
        items?.map((item) => ({
          ...item,
          price: priceMap.get(item.id) ?? null,
        })) ?? []
      );
    },

    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
  });
}

export default function ItemsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const orgId = useOrgId();

  const { data: categories, isLoading: isCategoriesLoading } =
    useItemCategories();

  const categoryNameById = new Map(
    categories?.map((category) => [category.id, category.name]) ?? []
  );

  const { data: items, isLoading } = useItemsWithPrices(
    search,
    categoryId,
    orgId
  );

  return (
    <div>
      <PageHeader
        title="Items"
        description="Master catalogue — all products, raw materials and traded goods"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/items/import")}
        >
          Import Items
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/items/import-bom")}
        >
          Import BOM
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

            <input
              type="text"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="
                w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              "
            />
          </div>

          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={isCategoriesLoading}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">All Categories</option>

            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <span className="text-xs text-slate-400 ml-auto">
            {items?.length ?? 0} items
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <TableLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">
                    Code
                  </th>

                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Name
                  </th>

                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Category
                  </th>

                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Material
                  </th>

                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Unit
                  </th>

                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Purchase Rate
                  </th>

                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Selling Rate
                  </th>

                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Type
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-50">
                {items?.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-12 text-slate-400 text-sm"
                    >
                      No items found
                    </td>
                  </tr>
                )}

                {items?.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/items/${item.id}`}>
                        <span className="font-mono text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:underline">
                          {item.item_code}
                        </span>
                      </Link>
                    </td>

                    <td className="px-4 py-3">
                      <Link
                        href={`/items/${item.id}`}
                        className="font-medium text-slate-900 hover:text-blue-600"
                      >
                        {item.name}
                      </Link>

                      {item.size_spec && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                          {item.size_spec}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <Badge variant="default">
                        {item.category_id
                          ? categoryNameById.get(item.category_id) ?? "—"
                          : "—"}
                      </Badge>
                    </td>

                    <td className="px-4 py-3 text-slate-600">
                      {item.material_type?.name ?? "—"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="font-mono text-xs text-slate-500">
                        {item.unit?.name ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {item.price?.purchase_rate ? (
                        formatCurrency(item.price.purchase_rate)
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {item.price?.selling_rate ? (
                        formatCurrency(item.price.selling_rate)
                      ) : (
                        <span className="text-slate-300 font-normal">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {item.is_traded && <Badge variant="info">Traded</Badge>}

                        {item.is_manufactured && (
                          <Badge variant="purple">Mfg</Badge>
                        )}

                        {item.is_raw_material && (
                          <Badge variant="teal">Raw</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
