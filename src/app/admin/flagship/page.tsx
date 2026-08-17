"use client";

import { useEffect, useState } from "react";

type FlagshipEra = {
  id: number;
  era: string;
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  gloss: string | null;
  needsVerification: boolean;
  orderIndex: number;
};

type FlagshipWord = {
  id: number;
  headword: string;
  status: "pending" | "draft" | "approved" | "rejected";
  driftType: "pejoration" | "amelioration" | "narrowing" | "widening" | "other" | null;
  driftSummary: string | null;
  eras: FlagshipEra[];
};

const ERA_LABELS: Record<string, string> = {
  old_english: "Old English",
  middle_english: "Middle English",
  early_modern_english: "Early Modern English",
  modern: "Modern",
};

export default function FlagshipAdminPage() {
  const [words, setWords] = useState<FlagshipWord[]>([]);
  const [headwordInput, setHeadwordInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadWords() {
    const res = await fetch("/api/flagship");
    const data = await res.json();
    setWords(data);
  }

  useEffect(() => {
    loadWords();
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!headwordInput.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/flagship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headword: headwordInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Generation failed");
      }
      setHeadwordInput("");
      await loadWords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(id: number) {
    await fetch(`/api/flagship/${id}/approve`, { method: "POST" });
    await loadWords();
  }

  async function handleReject(id: number) {
    await fetch(`/api/flagship/${id}/reject`, { method: "POST" });
    await loadWords();
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Flagship word curation</h1>
      <p className="mt-1 text-sm text-gray-500">
        Claude-assisted research drafts, pending human review before publish.
      </p>

      <form onSubmit={handleGenerate} className="mt-6 flex gap-2">
        <input
          type="text"
          value={headwordInput}
          onChange={(e) => setHeadwordInput(e.target.value)}
          placeholder="Add a headword, e.g. knight"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
          disabled={generating}
        />
        <button
          type="submit"
          disabled={generating}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {generating ? "Researching…" : "Generate draft"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-8 space-y-6">
        {words.map((word) => (
          <div key={word.id} className="rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">{word.headword}</h2>
              <StatusBadge status={word.status} />
            </div>

            {word.driftSummary && (
              <p className="mt-2 flex items-baseline gap-2 text-sm text-gray-700">
                {word.driftType && (
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                    {word.driftType}
                  </span>
                )}
                {word.driftSummary}
              </p>
            )}

            {/*
              TODO(Nae): era cards row.
              word.eras is ordered old -> modern (4 items typically). Render
              each as a small card: ERA_LABELS[era.era], era.form, era.ipa,
              era.quote + era.quoteCitation, era.gloss, and a small
              "needs verification" tag when era.needsVerification is true.

              Hint: this is a flex row that should wrap on narrow screens
              rather than overflow or squish — each card roughly equal width,
              a consistent gap between them. flex-wrap + a min-width per card
              is the shape to reach for.
            */}
            <div className="mt-4 text-sm text-gray-400 italic">
              [era cards go here]
            </div>

            {word.status === "draft" && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleApprove(word.id)}
                  className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(word.id)}
                  className="rounded bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
        {words.length === 0 && (
          <p className="text-sm text-gray-400">No flagship words yet.</p>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: FlagshipWord["status"] }) {
  const styles: Record<FlagshipWord["status"], string> = {
    pending: "bg-gray-100 text-gray-600",
    draft: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
