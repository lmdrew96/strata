"use client";

import { useEffect, useState } from "react";

type FlagshipEra = {
  id: number;
  era: string;
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  gloss: string | null;
  needsVerification: boolean;
  orderIndex: number;
};

type DriftType = "pejoration" | "amelioration" | "narrowing" | "widening" | "other";

type FlagshipSibling = {
  id: number;
  siblingHeadword: string;
  sharedAncestor: string;
};

type FlagshipWord = {
  id: number;
  headword: string;
  status: "pending" | "draft" | "approved" | "rejected";
  driftType: DriftType | null;
  eras: FlagshipEra[];
  siblings: FlagshipSibling[];
};

const ERA_LABELS: Record<string, string> = {
  old_english: "Old English",
  middle_english: "Middle English",
  early_modern_english: "Early Modern English",
  modern: "Modern",
};

const DRIFT_TYPES: DriftType[] = [
  "pejoration",
  "amelioration",
  "narrowing",
  "widening",
  "other",
];

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
    // loadWords is async — its setState happens after this effect body has
    // already returned, not synchronously. It's also reused as the shared
    // refresh function after generate/approve/reject/save, so it can't be
    // inlined away.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          <WordCard
            key={word.id}
            word={word}
            onApprove={() => handleApprove(word.id)}
            onReject={() => handleReject(word.id)}
            onSaved={loadWords}
          />
        ))}
        {words.length === 0 && (
          <p className="text-sm text-gray-400">No flagship words yet.</p>
        )}
      </div>
    </main>
  );
}

function WordCard({
  word,
  onApprove,
  onReject,
  onSaved,
}: {
  word: FlagshipWord;
  onApprove: () => void;
  onReject: () => void;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDriftType, setDraftDriftType] = useState<DriftType | null>(word.driftType);
  const [draftEras, setDraftEras] = useState<FlagshipEra[]>(word.eras);

  function startEditing() {
    setDraftDriftType(word.driftType);
    setDraftEras(word.eras);
    setEditing(true);
  }

  function updateEra(id: number, patch: Partial<FlagshipEra>) {
    setDraftEras((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/flagship/${word.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driftType: draftDriftType, eras: draftEras }),
      });
      await onSaved();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{word.headword}</h2>
        <div className="flex items-center gap-2">
          <StatusBadge status={word.status} />
          {!editing && (
            <button
              onClick={startEditing}
              className="rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <select
          value={draftDriftType ?? ""}
          onChange={(e) => setDraftDriftType(e.target.value as DriftType)}
          className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs uppercase"
        >
          {DRIFT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        word.eras.length > 0 && (
          <p className="mt-2 flex items-baseline gap-2 text-sm text-gray-700">
            {word.driftType && (
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                {word.driftType}
              </span>
            )}
            {word.eras.map((e) => e.gloss).join(" → ")}
          </p>
        )
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {(editing ? draftEras : word.eras).map((era) => (
          <div
            key={era.id}
            className="min-w-[220px] flex-1 rounded-md border border-gray-100 bg-gray-50 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium tracking-wide text-gray-400 uppercase">
                {ERA_LABELS[era.era] ?? era.era}
              </span>
              {editing ? (
                <label className="flex items-center gap-1 text-xs text-amber-700">
                  <input
                    type="checkbox"
                    checked={era.needsVerification}
                    onChange={(e) =>
                      updateEra(era.id, { needsVerification: e.target.checked })
                    }
                  />
                  needs verification
                </label>
              ) : (
                era.needsVerification && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    needs verification
                  </span>
                )
              )}
            </div>

            {editing ? (
              <div className="mt-1 space-y-1">
                <div className="flex gap-1">
                  <input
                    value={era.form}
                    onChange={(e) => updateEra(era.id, { form: e.target.value })}
                    placeholder="form"
                    className="w-1/2 rounded border border-gray-200 px-1.5 py-1 text-sm font-medium"
                  />
                  <input
                    value={era.ipa ?? ""}
                    onChange={(e) => updateEra(era.id, { ipa: e.target.value })}
                    placeholder="ipa"
                    className="w-1/2 rounded border border-gray-200 px-1.5 py-1 text-sm text-gray-500"
                  />
                </div>
                <input
                  value={era.gloss ?? ""}
                  onChange={(e) => updateEra(era.id, { gloss: e.target.value })}
                  placeholder="gloss"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-sm"
                />
                <textarea
                  value={era.quote ?? ""}
                  onChange={(e) => updateEra(era.id, { quote: e.target.value })}
                  placeholder="quote"
                  rows={2}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs italic"
                />
                <input
                  value={era.quoteCitation ?? ""}
                  onChange={(e) => updateEra(era.id, { quoteCitation: e.target.value })}
                  placeholder="citation"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs"
                />
                <input
                  value={era.quoteTranslation ?? ""}
                  onChange={(e) => updateEra(era.id, { quoteTranslation: e.target.value })}
                  placeholder="modern translation"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-500"
                />
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {era.form}
                  {era.ipa && (
                    <span className="ml-1.5 font-normal text-gray-500">/{era.ipa}/</span>
                  )}
                </p>

                {era.gloss && <p className="mt-1 text-sm text-gray-700">{era.gloss}</p>}

                {era.quote && (
                  <p className="mt-2 text-xs text-gray-500 italic">
                    &ldquo;{era.quote}&rdquo;
                    {era.quoteCitation && (
                      <span className="not-italic"> — {era.quoteCitation}</span>
                    )}
                  </p>
                )}
                {era.quoteTranslation && (
                  <p className="mt-1 text-xs text-gray-400">“{era.quoteTranslation}”</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {word.siblings.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-medium tracking-wide text-gray-400 uppercase">Siblings:</span>
          {word.siblings.map((s) => (
            <span key={s.id} className="rounded bg-gray-50 px-2 py-1">
              {s.siblingHeadword}{" "}
              <span className="text-gray-400">({s.sharedAncestor})</span>
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      ) : (
        word.status === "draft" && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={onApprove}
              className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Approve
            </button>
            <button
              onClick={onReject}
              className="rounded bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700"
            >
              Reject
            </button>
          </div>
        )
      )}
    </div>
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
