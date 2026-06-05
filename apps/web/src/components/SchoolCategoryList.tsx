"use client";

import { Tags } from "lucide-react";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  Alert,
  Button,
  EmptyState,
  Input,
  ListItem,
  SectionHeader,
} from "./ui";

interface Category {
  id: string;
  name: string;
  weightPercent: number;
  gradingPolicy: string;
}

export function SchoolCategoryList({
  classId,
  initialCategories,
  readOnly = false,
}: {
  classId: string;
  initialCategories: Category[];
  readOnly?: boolean;
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalWeight = categories.reduce((sum, c) => sum + c.weightPercent, 0);

  return (
    <div>
      {error && (
        <Alert variant="error" className="mb-3">
          {error}
        </Alert>
      )}
      {!readOnly && (
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setLoading(true);
          setError(null);
          try {
            const data = await apiClient.post<{ category: Category }>(
              `/api/school/classes/${classId}/categories`,
              {
                name: name.trim(),
                weightPercent: weight ? parseFloat(weight) : 0,
              },
            );
            setCategories((prev) => [...prev, data.category]);
            setName("");
            setWeight("");
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to add category");
          } finally {
            setLoading(false);
          }
        }}
      >
        <Input
          className="min-w-[140px] flex-1"
          placeholder="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Category name"
        />
        <Input
          className="w-24"
          type="number"
          min={0}
          max={100}
          step={1}
          placeholder="Weight %"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          aria-label="Weight percent"
        />
        <Button type="submit" loading={loading}>
          Add
        </Button>
      </form>
      )}
      {categories.length === 0 ? (
        <EmptyState
          title="No categories"
          description="Group assignments by type (e.g. Homework, Tests) and set grade weights."
          icon={<Tags className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <>
          <ul className="space-y-2" aria-label="Assignment categories">
            {categories.map((cat) => (
              <ListItem key={cat.id} as="li">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{cat.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {cat.weightPercent}% · {cat.gradingPolicy}
                  </p>
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${cat.name}`}
                    onClick={async () => {
                      setError(null);
                      try {
                        await apiClient.delete(`/api/school/categories/${cat.id}`);
                        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Failed to remove category");
                      }
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </ListItem>
            ))}
          </ul>
          {totalWeight > 0 && totalWeight !== 100 && (
            <p className="mt-3 text-xs text-[var(--color-warning)]">
              Weights total {totalWeight}% (100% recommended for weighted averages).
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SchoolCategoryCard({
  classId,
  initialCategories,
}: {
  classId: string;
  initialCategories: Category[];
}) {
  return (
    <>
      <SectionHeader title="Grade categories" />
      <SchoolCategoryList classId={classId} initialCategories={initialCategories} />
    </>
  );
}
