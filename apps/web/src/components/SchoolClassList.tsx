"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input } from "./ui";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
}

export function SchoolClassList({ initialClasses }: { initialClasses: SchoolClass[] }) {
  const [classes, setClasses] = useState(initialClasses);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      <Card>
        <CardBody>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setLoading(true);
              setError(null);
              try {
                const data = await apiClient.post<{ class: SchoolClass }>("/api/school/classes", {
                  name: name.trim(),
                  subject: subject.trim() || undefined,
                });
                setClasses((prev) => [...prev, data.class]);
                setName("");
                setSubject("");
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Failed to create class");
              } finally {
                setLoading(false);
              }
            }}
          >
            <Input
              className="min-w-[160px] flex-1"
              placeholder="Class name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="min-w-[120px]"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Button type="submit" loading={loading}>
              Create class
            </Button>
          </form>
        </CardBody>
      </Card>
      {classes.length === 0 ? (
        <EmptyState
          title="No classes"
          description="Create your first class above."
          icon={<BookOpen className="h-10 w-10" />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Link key={c.id} href={`/school/class/${c.id}`}>
              <Card className="h-full transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent-subtle)]/20">
                <CardBody>
                  <h2 className="font-medium">{c.name}</h2>
                  {c.subject && (
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">{c.subject}</p>
                  )}
                  {c.term && (
                    <Badge tone="default" className="mt-2">
                      {c.term}
                    </Badge>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
