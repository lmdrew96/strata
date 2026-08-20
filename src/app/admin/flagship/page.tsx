"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "../../Header";

type SourcingTier = "green" | "amber" | "red" | "n_a";

type PendingEraRevision = {
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  quoteSourceUrl: string | null;
  gloss: string | null;
  sourcingTier: SourcingTier;
  needsVerification: boolean;
  verificationNote: string | null;
  generatedAt: string;
};

type FlagshipEra = {
  id: number;
  era: string;
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  quoteSourceUrl: string | null;
  gloss: string | null;
  sourcingTier: SourcingTier | null;
  needsVerification: boolean;
  verificationNote: string | null;
  humanEdited: boolean;
  pendingRevision: PendingEraRevision | null;
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

const TIER_LABELS: Record<SourcingTier, string> = {
  green: "green",
  amber: "amber",
  red: "red",
  n_a: "n/a",
};

const TIER_STYLES: Record<SourcingTier, string> = {
  green: "bg-green-500/20 text-green-300",
  amber: "bg-amber-500/20 text-amber-300",
  red: "bg-red-500/20 text-red-300",
  n_a: "bg-strata-parchment/10 text-strata-parchment/50",
};

// Amber sub-triage (ChaosPatch d9146072): amber became the dominant tier by
// volume once green got restricted to structurally collision-proof matches
// (e3680b1a's churl/boor fix), and it was hiding two very different jobs.
// quote_source_url is the correct signal, not quote/quote_citation -- it's
// set ONLY by an evidence-derived amber row (a corpus/lemma match that just
// needs a sense-check), and stays null for a model-self-reported quote with
// no captured source (which needs Nae to find the source herself -- much
// closer in effort to a true gap than to a quick confirm, even though it
// technically has quote text).
type AmberBucket = "has_candidate" | "true_gap";

function amberBucket(era: { sourcingTier: SourcingTier | null; quoteSourceUrl: string | null }): AmberBucket | null {
  if (era.sourcingTier !== "amber") return null;
  return era.quoteSourceUrl ? "has_candidate" : "true_gap";
}

const AMBER_BUCKET_LABELS: Record<AmberBucket, string> = {
  has_candidate: "has candidate",
  true_gap: "true gap",
};

const AMBER_BUCKET_STYLES: Record<AmberBucket, string> = {
  has_candidate: "bg-strata-coral/20 text-strata-coral",
  true_gap: "bg-strata-parchment/10 text-strata-parchment/50",
};

const TIER_ORDER: SourcingTier[] = ["green", "amber", "red", "n_a"];

export default function FlagshipAdminPage() {
  const router = useRouter();
  const [words, setWords] = useState<FlagshipWord[]>([]);
  const [headwordInput, setHeadwordInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FlagshipWord["status"] | "all">("all");
  // Defaults to amber -- that's Nae's actual work queue (etymology asserted,
  // no corpus/kaikki-confirmed quote yet). "all" shows everything.
  const [tierFilter, setTierFilter] = useState<SourcingTier | "all">("amber");
  // Only meaningful while tierFilter === "amber" -- lets the quick-confirm
  // pass and the sit-down-research pass be worked as separate batches
  // instead of interleaved (ChaosPatch d9146072).
  const [amberSubFilter, setAmberSubFilter] = useState<AmberBucket | "all">("all");

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

  async function generateDraft(headword: string, force: boolean) {
    const res = await fetch("/api/flagship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headword, force }),
    });
    if (res.ok) return true;

    const body = await res.json();
    // 409 means generateFlagshipDraft blocked because the word is already
    // approved -- offer the explicit-intent confirmation the pipeline
    // requires (see ChaosPatch 9d724e79) instead of just failing.
    if (res.status === 409 && !force) {
      const proceed = window.confirm(
        `${body.error}\n\nRegenerate anyway? Human-edited and approved eras still won't be overwritten directly -- you'll get pending revisions to review.`,
      );
      if (proceed) return generateDraft(headword, true);
      return false;
    }
    throw new Error(body.error ?? "Generation failed");
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!headwordInput.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const ok = await generateDraft(headwordInput.trim().toLowerCase(), false);
      if (ok) setHeadwordInput("");
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

  const filteredWords = words
    .filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      // A tier-narrowed view (the amber work queue, most importantly) is
      // meant to surface undecided words -- approved/rejected words are
      // done being reviewed, and can still legitimately carry an amber/red
      // era (tier records evidence quality, not review status; see
      // sourcingTierEnum's doc comment). Only hide them when statusFilter
      // hasn't explicitly asked for that status.
      if (
        tierFilter !== "all" &&
        statusFilter === "all" &&
        (w.status === "approved" || w.status === "rejected")
      ) {
        return false;
      }
      if (tierFilter !== "all" && !w.eras.some((e) => e.sourcingTier === tierFilter)) return false;
      if (
        tierFilter === "amber" &&
        amberSubFilter !== "all" &&
        !w.eras.some((e) => amberBucket(e) === amberSubFilter)
      ) {
        return false;
      }
      if (searchQuery.trim() && !w.headword.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
        return false;
      }
      return true;
    })
    // While viewing the amber queue, surface the quick-confirm words first --
    // ranked by how many true-gap eras they still carry, so a pure
    // has-candidate word (0 true gaps) always sorts ahead of a mixed or
    // all-true-gap one, letting Nae batch through the fast ones before
    // sitting down with the real research pile.
    .sort((a, b) => {
      if (tierFilter !== "amber") return 0;
      const trueGapCount = (w: FlagshipWord) => w.eras.filter((e) => amberBucket(e) === "true_gap").length;
      return trueGapCount(a) - trueGapCount(b);
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
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as SourcingTier | "all")}
              className="font-data rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment"
            >
              <option value="amber" className="bg-strata-rosewood">
                Amber (work queue)
              </option>
              <option value="all" className="bg-strata-rosewood">
                All tiers
              </option>
              {TIER_ORDER.filter((t) => t !== "amber").map((t) => (
                <option key={t} value={t} className="bg-strata-rosewood">
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
            {tierFilter === "amber" && (
              <select
                value={amberSubFilter}
                onChange={(e) => setAmberSubFilter(e.target.value as AmberBucket | "all")}
                className="font-data rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment"
              >
                <option value="all" className="bg-strata-rosewood">
                  Has candidate + true gap
                </option>
                <option value="has_candidate" className="bg-strata-rosewood">
                  Has candidate only (quick pass)
                </option>
                <option value="true_gap" className="bg-strata-rosewood">
                  True gap only (research pass)
                </option>
              </select>
            )}
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
  const [resolvingRevision, setResolvingRevision] = useState<number | null>(null);

  async function handleResolveRevision(eraId: number, action: "accept" | "reject") {
    setResolvingRevision(eraId);
    setActionError(null);
    try {
      const res = await fetch(`/api/flagship/${word.id}/resolve-revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eraId, action }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to resolve revision");
      }
      await onSaved();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to resolve revision");
    } finally {
      setResolvingRevision(null);
    }
  }

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
      quoteSourceUrl: "",
      gloss: "",
      // Amber: a manually added era is Nae's own assertion, not corpus-
      // confirmed -- same status a model-asserted-but-unconfirmed era gets.
      sourcingTier: "amber",
      needsVerification: true,
      verificationNote: "Manually added — not yet verified.",
      humanEdited: true,
      pendingRevision: null,
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
              <span className="font-data flex items-center gap-2 text-xs font-medium tracking-wide text-strata-parchment/40 uppercase">
                {ERA_LABELS[era.era] ?? era.era}
                {!editing && era.sourcingTier && (
                  <span
                    className={`normal-case ${TIER_STYLES[era.sourcingTier]} rounded px-1.5 py-0.5 text-xs font-medium`}
                  >
                    {TIER_LABELS[era.sourcingTier]}
                  </span>
                )}
                {!editing &&
                  amberBucket(era) && (
                    <span
                      className={`normal-case ${AMBER_BUCKET_STYLES[amberBucket(era) as AmberBucket]} rounded px-1.5 py-0.5 text-xs font-medium`}
                    >
                      {AMBER_BUCKET_LABELS[amberBucket(era) as AmberBucket]}
                    </span>
                  )}
              </span>
              {editing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={era.sourcingTier ?? "amber"}
                    onChange={(e) => updateEra(era.id, { sourcingTier: e.target.value as SourcingTier })}
                    className={`font-data rounded border border-strata-parchment/20 px-1.5 py-0.5 text-xs normal-case ${TIER_STYLES[era.sourcingTier ?? "amber"]}`}
                  >
                    {TIER_ORDER.map((t) => (
                      <option key={t} value={t} className="bg-strata-rosewood text-strata-parchment">
                        {TIER_LABELS[t]}
                      </option>
                    ))}
                  </select>
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

            {!editing && era.pendingRevision && (
              <div className="mt-2 rounded border border-strata-coral/40 bg-strata-coral/10 p-2">
                <p className="font-data text-xs font-medium text-strata-coral">
                  Pending revision from regeneration — this row is protected
                  {era.humanEdited ? " (hand-edited)" : " (word is approved)"}, so it was
                  not overwritten.
                </p>
                <div className="font-data mt-1.5 space-y-0.5 text-xs text-strata-parchment/70">
                  <p>
                    <span className="text-strata-parchment/40">tier:</span>{" "}
                    <span className={`rounded px-1 ${TIER_STYLES[era.pendingRevision.sourcingTier]}`}>
                      {TIER_LABELS[era.pendingRevision.sourcingTier]}
                    </span>
                  </p>
                  <p>
                    <span className="text-strata-parchment/40">form:</span> {era.pendingRevision.form}
                  </p>
                  {era.pendingRevision.quote && (
                    <p className="font-body-serif italic">
                      &ldquo;{era.pendingRevision.quote}&rdquo;
                      {era.pendingRevision.quoteCitation && (
                        <span className="not-italic"> — {era.pendingRevision.quoteCitation}</span>
                      )}
                    </p>
                  )}
                  {era.pendingRevision.gloss && (
                    <p>
                      <span className="text-strata-parchment/40">gloss:</span>{" "}
                      {era.pendingRevision.gloss}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolveRevision(era.id, "accept")}
                    disabled={resolvingRevision !== null}
                    className="font-data rounded bg-strata-coral px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-strata-coral/90 disabled:opacity-50"
                  >
                    {resolvingRevision === era.id ? "…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveRevision(era.id, "reject")}
                    disabled={resolvingRevision !== null}
                    className="font-data rounded border border-strata-parchment/20 px-2 py-1 text-xs text-strata-parchment/60 transition-colors hover:border-strata-coral/50 hover:text-strata-parchment disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
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
                <input
                  value={era.quoteSourceUrl ?? ""}
                  onChange={(e) => updateEra(era.id, { quoteSourceUrl: e.target.value })}
                  placeholder="source (corpus:..., kaikki:..., or a URL)"
                  className="w-full rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-1.5 py-1 text-xs text-strata-parchment/60"
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
                {era.quoteSourceUrl && (
                  <p className="font-data mt-1 text-xs text-strata-parchment/30">
                    source:{" "}
                    {era.quoteSourceUrl.startsWith("http") ? (
                      <a
                        href={era.quoteSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-strata-parchment/60"
                      >
                        {era.quoteSourceUrl}
                      </a>
                    ) : (
                      era.quoteSourceUrl
                    )}
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
