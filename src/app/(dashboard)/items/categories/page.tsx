"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useOrgId } from "@/lib/hooks/use-tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, Pencil, Power, Search } from "lucide-react";

interface Category {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface CategoryForm {
  code: string;
  name: string;
  description: string;
}

const emptyForm: CategoryForm = {
  code: "",
  name: "",
  description: "",
};

export default function ItemCategoriesPage() {
  const supabase = createClient();
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const {
    data: categories = [],
    isLoading,
    error,
  } = useQuery<Category[]>({
    queryKey: ["item-categories", orgId],

    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("item_categories")
        .select("id, code, name, description, is_active")
        .eq("org_id", orgId)
        .order("name");

      if (error) throw error;

      return data ?? [];
    },

    enabled: !!orgId,
  });

  const filteredCategories = categories.filter((category) => {
    const term = search.trim().toLowerCase();

    if (!term) return true;

    return (
      category.code.toLowerCase().includes(term) ||
      category.name.toLowerCase().includes(term) ||
      (category.description ?? "").toLowerCase().includes(term)
    );
  });

  function openAddModal() {
    setEditingCategory(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEditModal(category: Category) {
    setEditingCategory(category);

    setForm({
      code: category.code,
      name: category.name,
      description: category.description ?? "",
    });

    setShowModal(true);
  }

  function closeModal() {
    if (saving) return;

    setShowModal(false);
    setEditingCategory(null);
    setForm(emptyForm);
  }

  function updateForm(field: keyof CategoryForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSave() {
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const description = form.description.trim();

    if (!code) {
      toast.error("Category code is required");
      return;
    }

    if (!name) {
      toast.error("Category name is required");
      return;
    }

    setSaving(true);

    try {
      if (editingCategory) {
        const { error } = await supabase
          .from("item_categories")
          .update({
            code,
            name,
            description: description || null,
          })
          .eq("id", editingCategory.id)
          .eq("org_id", orgId);

        if (error) throw error;

        toast.success("Category updated");
      } else {
        const { error } = await supabase.from("item_categories").insert({
          org_id: orgId,
          code,
          name,
          description: description || null,
        });

        if (error) throw error;

        toast.success("Category created");
      }

      await queryClient.invalidateQueries({
        queryKey: ["item-categories", orgId],
      });

      closeModal();
    } catch (err: unknown) {
      console.error("CATEGORY SAVE ERROR:", err);

      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String(err.message)
          : "Failed to save category";

      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: Category) {
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    try {
      const { error } = await supabase
        .from("item_categories")
        .update({
          is_active: !category.is_active,
        })
        .eq("id", category.id)
        .eq("org_id", orgId);

      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ["item-categories", orgId],
      });

      toast.success(
        category.is_active ? "Category deactivated" : "Category activated"
      );
    } catch (err: unknown) {
      console.error("CATEGORY STATUS ERROR:", err);

      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String(err.message)
          : "Failed to update category";

      toast.error(message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Item Categories"
        description="Manage item categories for your organization"
      >
        <Button size="sm" onClick={openAddModal}>
          <Plus className="w-4 h-4" />
          Add Category
        </Button>
      </PageHeader>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

            <input
              type="text"
              placeholder="Search categories…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <span className="text-xs text-slate-400 ml-auto">
            {filteredCategories.length} categories
          </span>
        </div>
      </div>

      {/* Categories */}
      <Card>
        <CardBody>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Loading categories...
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-red-500">
              Failed to load categories
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {search
                ? "No categories match your search."
                : "No item categories found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Code
                    </th>

                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Name
                    </th>

                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Description
                    </th>

                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Status
                    </th>

                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredCategories.map((category) => (
                    <tr key={category.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-slate-600">
                          {category.code}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-700">
                          {category.name}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-sm text-slate-500">
                        {category.description || "—"}
                      </td>

                      <td className="px-4 py-3">
                        <Badge
                          variant={category.is_active ? "success" : "default"}
                        >
                          {category.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(category)}
                          >
                            <Pencil className="w-4 h-4 mr-1" />
                            Edit
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleCategory(category)}
                          >
                            <Power className="w-4 h-4 mr-1" />
                            {category.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingCategory ? "Edit Item Category" : "Add Item Category"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {editingCategory
                  ? "Update the category details."
                  : "Create a category for your organization."}
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Code
                </label>

                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => updateForm("code", e.target.value)}
                  placeholder="e.g. CONDUCTOR"
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
                />

                <p className="mt-1 text-xs text-slate-500">
                  Used as the unique internal category code.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Name
                </label>

                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="e.g. Conductor"
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Description
                </label>

                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button variant="outline" onClick={closeModal} disabled={saving}>
                Cancel
              </Button>

              <Button onClick={handleSave} disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingCategory
                  ? "Save Changes"
                  : "Create Category"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
