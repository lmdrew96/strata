"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "../../Header";

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
  verificationNote: string | null;
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

// Chronological order, used to keep a chronologically-sorted era list when
// one gets added mid-edit and to derive orderIndex on save.
const ERAS = Object.keys(ERA_LABELS);

const DRIFT_TYPES: DriftType[] = [
  "pejoration",
  "amelioration",
  "narrowing",
  "widening",
  "other",
];

export default function FlagshipAdminPage() {
  const router = useRouter();
  const [words, setWords] = useState<FlagshipWord[]>([]);
  const [headwordInput, setHeadwordInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FlagshipWord["status"] | "all">("all");

  async function handleSignOut() {
    await fetch("/api/admin-logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

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

  const filteredWords = words.filter((w) => {
    if (statusFilter !== "all" && w.status !== statusFilter) return false;
    if (searchQuery.trim() && !w.headword.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <>
      <Header />
      <main className="min-h-screen bg-strata-teal">
        <div className="mx-auto max-w-4xl p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-medium text-strata-parchment">
                Flagship word curation
              </h1>
              <p className="font-data mt-1 text-sm text-strata-parchment/50">
                Claude-assisted research drafts, pending human review before publish.
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="font-data shrink-0 rounded border border-strata-parchment/20 px-3 py-1.5 text-xs font-medium text-strata-parchment/60 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment"
            >
              Sign out
            </button>
          </div>

          <form onSubmit={handleGenerate} className="mt-6 flex gap-2">
            <input
              type="text"
              value={headwordInput}
              onChange={(e) => setHeadwordInput(e.target.value)}
              placeholder="Add a headword, e.g. knight"
              className="font-data flex-1 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment placeholder:text-strata-parchment/40 focus:border-strata-coral/50 focus:outline-none"
              disabled={generating}
            />
            <button
              type="submit"
              disabled={generating}
              className="rounded bg-strata-coral px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-strata-coral/90 disabled:opacity-50"
            >
              {generating ? "Researching…" : "Generate draft"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

          <div className="mt-6 flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search headwords…"
              className="font-data flex-1 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment placeholder:text-strata-parchment/40 focus:border-strata-coral/50 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FlagshipWord["status"] | "all")}
              className="font-data rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment"
            >
              <option value="all" className="bg-strata-rosewood">
                All statuses
              </option>
              <option value="pending" className="bg-strata-rosewood">
                Pending
              </option>
              <option value="draft" className="bg-strata-rosewood">
                Draft
              </option>
              <option value="approved" className="bg-strata-rosewood">
                Approved
              </option>
              <option value="rejected" className="bg-strata-rosewood">
                Rejected
              </option>
            </select>
          </div>

          <div className="mt-6 space-y-6">
            {filteredWords.map((word) => (
              <WordCard
                key={word.id}
                word={word}
                onApprove={() => handleApprove(word.id)}
                onReject={() => handleReject(word.id)}
                onSaved={loadWords}
              />
            ))}
            {words.length === 0 && (
              <p className="font-data text-sm text-strata-parchment/40">
                No flagship words yet.
              </p>
            )}
            {words.length > 0 && filteredWords.length === 0 && (
              <p className="font-data text-sm text-strata-parchment/40">
                No words match this search/filter.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
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
  // Newly-added eras aren't in the DB yet, so they get a negative local id
  // (real ids are serial/positive) -- update/route.ts treats id < 0 as "insert".
  const nextTempId = useRef(-1);
  // Regenerate/translate act on one era at a time -- neither writes to the
  // DB itself, they just hand back a draft for updateEra to merge in, same
  // as typing into the fields by hand. Nothing commits until Save.
  const [busyEra, setBusyEra] = useState<{ id: number; action: "regenerate" | "translate" } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  function startEditing() {
    setDraftDriftType(word.driftType);
    setDraftEras(word.eras);
    setEditing(true);
  }

  function updateEra(id: number, patch: Partial<FlagshipEra>) {
    setDraftEras((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function addEra(era: string) {
    const newEra: FlagshipEra = {
      id: nextTempId.current--,
      era,
      form: "",
      ipa: "",
      quote: "",
      quoteCitation: "",
      quoteTranslation: "",
      gloss: "",
      needsVerification: true,
      verificationNote: "Manually added — not yet verified.",
      orderIndex: 0,
    };
    setDraftEras((prev) =>
      [...prev, newEra].sort((a, b) => ERAS.indexOf(a.era) - ERAS.indexOf(b.era)),
    );
  }

  function removeEra(id: number) {
    setDraftEras((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleRegenerateEra(era: FlagshipEra) {
    setBusyEra({ id: era.id, action: "regenerate" });
    setActionError(null);
    try {
      const res = await fetch(`/api/flagship/${word.id}/regenerate-era`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ era: era.era }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Regeneration failed");
      }
      const draft = await res.json();
      updateEra(era.id, draft);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setBusyEra(null);
    }
  }

  async function handleTranslateQuote(era: FlagshipEra) {
    if (!era.quote) return;
    setBusyEra({ id: era.id, action: "translate" });
    setActionError(null);
    try {
      const res = await fetch("/api/flagship/translate-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: era.quote, form: era.form, era: era.era }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Translation failed");
      }
      const { translation } = await res.json();
      updateEra(era.id, { quoteTranslation: translation });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setBusyEra(null);
    }
  }

  const missingEras = ERAS.filter((k) => !draftEras.some((e) => e.era === k));

  async function handleSave() {
    setSaving(true);
    try {
      // draftEras is kept chronologically sorted (addEra re-sorts on
      // insert), so its array order doubles as the new orderIndex.
      const eras = draftEras.map((e, i) => ({ ...e, orderIndex: i }));
      await fetch(`/api/flagship/${word.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driftType: draftDriftType, eras }),
      });
      await onSaved();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-strata-parchment/15 bg-strata-rosewood/20 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-medium text-strata-parchment">
          {word.headword}
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge status={word.status} />
          {!editing && (
            <button
              onClick={startEditing}
              className="font-data rounded border border-strata-parchment/20 px-2 py-1 text-xs font-medium text-strata-parchment/60 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment"
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
          className="font-data mt-2 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-2 py-1 text-xs text-strata-parchment uppercase"
        >
          {DRIFT_TYPES.map((t) => (
            <option key={t} value={t} className="bg-strata-rosewood">
              {t}
            </option>
          ))}
        </select>
      ) : (
        word.eras.length > 0 && (
          <p className="font-data mt-2 flex items-baseline gap-2 text-sm text-strata-parchment/70">
            {word.driftType && (
              <span className="shrink-0 rounded bg-strata-parchment/10 px-1.5 py-0.5 text-xs font-medium tracking-wide text-strata-parchment/50 uppercase">
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
            className="min-w-[220px] flex-1 rounded-md border border-strata-parchment/10 bg-strata-rosewood/20 p-3"
          >
            <div className={editing ? "flex flex-col gap-1.5" : "flex items-center justify-between gap-2"}>
              <span className="font-data text-xs font-medium tracking-wide text-strata-parchment/40 uppercase">
                {ERA_LABELS[era.era] ?? era.era}
              </span>
              {editing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-data flex items-center gap-1 text-xs text-amber-400">
                    <input
                      type="checkbox"
                      checked={era.needsVerification}
                      onChange={(e) =>
                        updateEra(era.id, { needsVerification: e.target.checked })
                      }
                    />
                    needs verification
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRegenerateEra(era)}
                    disabled={busyEra !== null}
                    className="font-data rounded border border-strata-parchment/20 px-1.5 py-0.5 text-xs text-strata-parchment/60 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment disabled:opacity-50"
                  >
                    {busyEra?.id === era.id && busyEra.action === "regenerate"
                      ? "Researching…"
                      : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEra(era.id)}
                    disabled={busyEra !== null}
                    className="font-data rounded border border-red-500/30 px-1.5 py-0.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                era.needsVerification && (
                  <span className="font-data shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">
                    needs verification
                  </span>
                )
              )}
            </div>

            {!editing && era.needsVerification && era.verificationNote && (
              <p className="font-data mt-1 text-xs text-amber-300/70 italic">
                {era.verificationNote}
              </p>
            )}

            {editing && era.needsVerification && (
              <input
                value={era.verificationNote ?? ""}
                onChange={(e) => updateEra(era.id, { verificationNote: e.target.value })}
                placeholder="why does this need verification?"
                className="font-data mt-1 w-full rounded border border-amber-500/30 bg-strata-rosewood/20 px-1.5 py-1 text-xs text-amber-200 placeholder:text-amber-200/40"
              />
            )}

            {editing ? (
              <div className="mt-1 space-y-1">
                <div className="flex gap-1">
                  <input
                    value={era.form}
                    onChange={(e) => updateEra(era.id, { form: e.target.value })}
                    placeholder="form"
                    className="w-1/2 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-sm font-medium text-strata-parchment"
                  />
                  <input
                    value={era.ipa ?? ""}
                    onChange={(e) => updateEra(era.id, { ipa: e.target.value })}
                    placeholder="ipa"
                    className="w-1/2 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-sm text-strata-parchment/60"
                  />
                </div>
                <input
                  value={era.gloss ?? ""}
                  onChange={(e) => updateEra(era.id, { gloss: e.target.value })}
                  placeholder="gloss"
                  className="w-full rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-sm text-strata-parchment"
                />
                <textarea
                  value={era.quote ?? ""}
                  onChange={(e) => updateEra(era.id, { quote: e.target.value })}
                  placeholder="quote"
                  rows={2}
                  className="w-full rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-xs text-strata-parchment italic"
                />
                <input
                  value={era.quoteCitation ?? ""}
                  onChange={(e) => updateEra(era.id, { quoteCitation: e.target.value })}
                  placeholder="citation"
                  className="w-full rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-xs text-strata-parchment"
                />
                <div className="flex gap-1">
                  <input
                    value={era.quoteTranslation ?? ""}
                    onChange={(e) => updateEra(era.id, { quoteTranslation: e.target.value })}
                    placeholder="modern translation"
                    className="flex-1 rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-xs text-strata-parchment/60"
                  />
                  <button
                    type="button"
                    onClick={() => handleTranslateQuote(era)}
                    disabled={!era.quote || busyEra !== null}
                    className="font-data shrink-0 rounded border border-strata-parchment/20 px-1.5 py-1 text-xs text-strata-parchment/60 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment disabled:opacity-50"
                  >
                    {busyEra?.id === era.id && busyEra.action === "translate" ? "…" : "Translate"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm font-medium text-strata-parchment">
                  {era.form}
                  {era.ipa && (
                    <span className="ml-1.5 font-normal text-strata-parchment/50">
                      /{era.ipa}/
                    </span>
                  )}
                </p>

                {era.gloss && (
                  <p className="font-data mt-1 text-sm text-strata-parchment/70">{era.gloss}</p>
                )}

                {era.quote && (
                  <p className="font-body-serif mt-2 text-xs text-strata-parchment/60 italic">
                    &ldquo;{era.quote}&rdquo;
                    {era.quoteCitation && (
                      <span className="not-italic"> — {era.quoteCitation}</span>
                    )}
                  </p>
                )}
                {era.quoteTranslation && (
                  <p className="font-data mt-1 text-xs text-strata-parchment/40">
                    “{era.quoteTranslation}”
                  </p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {editing && actionError && (
        <p className="font-data mt-3 text-xs text-red-400">{actionError}</p>
      )}

      {editing && missingEras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {missingEras.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => addEra(k)}
              className="font-data rounded border border-dashed border-strata-parchment/30 px-2 py-1 text-xs text-strata-parchment/50 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment"
            >
              + {ERA_LABELS[k]}
            </button>
          ))}
        </div>
      )}

      {word.siblings.length > 0 && (
        <div className="font-data mt-4 flex flex-wrap items-center gap-2 text-xs text-strata-parchment/60">
          <span className="font-medium tracking-wide text-strata-parchment/40 uppercase">
            Siblings:
          </span>
          {word.siblings.map((s) => (
            <span key={s.id} className="rounded bg-strata-parchment/10 px-2 py-1">
              {s.siblingHeadword}{" "}
              <span className="text-strata-parchment/40">({s.sharedAncestor})</span>
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-strata-coral px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-strata-coral/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded border border-strata-parchment/20 px-3 py-1.5 text-sm font-medium text-strata-parchment/70"
          >
            Cancel
          </button>
        </div>
      ) : (
        word.status === "draft" && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={onApprove}
              className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500"
            >
              Approve
            </button>
            <button
              onClick={onReject}
              className="rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
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
    pending: "bg-strata-parchment/10 text-strata-parchment/60",
    draft: "bg-amber-500/20 text-amber-300",
    approved: "bg-green-500/20 text-green-300",
    rejected: "bg-red-500/20 text-red-300",
  };
  return (
    <span
      className={`font-data rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
