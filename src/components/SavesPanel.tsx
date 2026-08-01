import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileDown, FileUp, FolderOpen, FolderPlus, Globe, Layers3, Lock, Package, Pencil, Trash2 } from "lucide-react";
import { FORMATS, type ThumbDoc } from "../state";
import {
  type CampaignMeta,
  type ConfigMeta,
  type PublicConfigMeta,
  createCampaign,
  deleteCampaign,
  deleteConfig,
  exportConfigFile,
  importConfigFile,
  listCampaigns,
  listConfigs,
  listPublicConfigs,
  loadConfig,
  loadPublicConfig,
  publicBlobUrl,
  renameCampaign,
  setProjectCampaign,
  setProjectPublic,
} from "../lib/storage";
import { previewUrl } from "../lib/preview";
import { Hint, Section, UploadButton } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn, relTime } from "@/lib/utils";

type Props = {
  doc: ThumbDoc; // current working canvas, for "export current"
  projectId: string | null; // which archived project is live, if any
  projectName: string; // live name, mirrored onto the active row
  onLoad: (doc: ThumbDoc, name: string, id: string | null, savedAt: number | null) => void;
  onError: (msg: string) => void;
  /** false for a guest: the archive is replaced by the public gallery, which is a list of
   *  published designs and one action — open a local copy. */
  canWrite: boolean;
  refreshKey?: number;
  /** Hands a campaign to the offscreen renderer that zips every design in it (see `App.tsx`). */
  onExportCampaign: (campaign: { id: string; name: string }) => void;
  /** Accordion state, owned by the rail (see `App.tsx`). */
  open: boolean;
  onToggle: () => void;
};

const UNGROUPED = "__none__"; // Radix Select has no concept of a null value

/** The project library, grouped by campaign. A campaign is a folder: a project belongs to
 *  at most one, and deleting a campaign keeps its designs (they fall back to "No
 *  campaign"). The live project, if it came from here, is pinned visually. */
export function SavesPanel(props: Props) {
  // Two different lists, two different endpoints, two different sets of actions — a flag
  // threaded through one component would be a maze of `canWrite &&`. Split at the top instead.
  return props.canWrite ? <ArchivePanel {...props} /> : <PublicGallery {...props} />;
}

function ArchivePanel({ doc, projectId, projectName, onLoad, onError, refreshKey, onExportCampaign, open, onToggle }: Props) {
  const [configs, setConfigs] = useState<ConfigMeta[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignMeta[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([listConfigs(), listCampaigns()])
      .then(([c, g]) => { setConfigs(c); setCampaigns(g); })
      .catch(() => onError("Couldn't read the archive."));
  useEffect(() => { void refresh(); }, [refreshKey]);

  // One pass over the list: each campaign's designs, then whatever is left over.
  const groups = useMemo(() => {
    const byCampaign = new Map<string, ConfigMeta[]>();
    const loose: ConfigMeta[] = [];
    for (const c of configs) {
      if (c.campaignId) {
        const list = byCampaign.get(c.campaignId);
        list ? list.push(c) : byCampaign.set(c.campaignId, [c]);
      } else {
        loose.push(c);
      }
    }
    return { byCampaign, loose };
  }, [configs]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onDelete(id: string) {
    await deleteConfig(id);
    await refresh();
  }

  // The list carries only metadata; the full doc (with images) is fetched on demand.
  async function onOpen(c: ConfigMeta) {
    setBusyId(c.id);
    try {
      const full = await loadConfig(c.id);
      onLoad(full.doc, full.name, full.id, full.updatedAt);
      onError("");
    } catch {
      onError("Couldn't load the project.");
    } finally {
      setBusyId(null);
    }
  }

  async function onExport(c: ConfigMeta) {
    setBusyId(c.id);
    try {
      const full = await loadConfig(c.id);
      exportConfigFile(full.doc, full.name);
    } catch {
      onError("Couldn't export the project.");
    } finally {
      setBusyId(null);
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const { name, doc: imported } = await importConfigFile(file);
      onLoad(imported, name ?? "Untitled", null, null);
      onError("");
    } catch {
      onError("Invalid JSON file.");
    }
  }

  async function onCreateCampaign() {
    const name = draftName.trim();
    if (!name) return;
    try {
      await createCampaign(name);
      setDraftName("");
      setCreating(false);
      await refresh();
    } catch {
      onError("Couldn't create the campaign.");
    }
  }

  async function onRenameCampaign(id: string) {
    const name = draftName.trim();
    if (!name) return;
    try {
      await renameCampaign(id, name);
      setRenaming(null);
      setDraftName("");
      await refresh();
    } catch {
      onError("Couldn't rename.");
    }
  }

  async function onDeleteCampaign(id: string) {
    try {
      await deleteCampaign(id);
      await refresh();
    } catch {
      onError("Couldn't delete the campaign.");
    }
  }

  async function onMove(id: string, campaignId: string | null) {
    setBusyId(id);
    try {
      await setProjectCampaign(id, campaignId);
      await refresh();
    } catch {
      onError("Couldn't move the project.");
    } finally {
      setBusyId(null);
    }
  }

  /** Publishes a design to the public gallery, or takes it down. Optimistic, because the row
   *  has to answer immediately; the refresh underneath is what makes it true. */
  async function onPublish(c: ConfigMeta) {
    const next = !c.isPublic;
    setConfigs((prev) => prev.map((p) => (p.id === c.id ? { ...p, isPublic: next } : p)));
    try {
      await setProjectPublic(c.id, next);
      await refresh();
    } catch {
      setConfigs((prev) => prev.map((p) => (p.id === c.id ? { ...p, isPublic: !next } : p)));
      onError(next ? "Couldn't publish the project." : "Couldn't unpublish the project.");
    }
  }

  function ProjectRow({ c, campaignName }: { c: ConfigMeta; campaignName?: string }) {
    const active = c.id === projectId;
    // Inside a campaign every design is named "<campaign> — <format>", which truncates to an
    // identical stub on every row. Drop the prefix there; the group header already says it.
    const prefixed = !!campaignName && c.name.startsWith(`${campaignName} — `);
    const shown = active ? projectName : prefixed ? c.name.slice(campaignName!.length + 3) : c.name;
    // Don't repeat the format when stripping already left the name showing it.
    const fmt = !prefixed && c.format && FORMATS[c.format] ? `${FORMATS[c.format].label} · ` : "";
    const meta = active ? "Open" : `${fmt}${relTime(c.updatedAt)}`;
    return (
      <div
        className={cn(
          "group flex items-center gap-0.5 rounded-md transition-colors",
          active ? "layer-accent bg-accent/50" : "hover:bg-accent/40"
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left disabled:opacity-60"
          title={active ? "Current project" : "Open"}
          disabled={busyId === c.id}
          onClick={() => void onOpen(c)}
        >
          {/* Fixed frame either way, so rows with and without a preview still line up. */}
          <span
            className={cn(
              "grid h-7 w-12 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-black/40 ring-1",
              active ? "ring-primary/40" : "ring-border/70"
            )}
          >
            {c.preview ? (
              <img
                src={previewUrl(c.preview)}
                alt=""
                loading="lazy"
                decoding="async"
                // contain, not cover: a 9:16 story has to read as a story, not a crop.
                className="h-full w-full object-contain"
              />
            ) : (
              <FolderOpen className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-sm leading-tight">{shown}</span>
              {c.isPublic && <Globe className="size-3 shrink-0 text-primary" aria-label="Published" />}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">{meta}</span>
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-7 transition-opacity",
            c.isPublic
              ? "text-primary opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          )}
          title={c.isPublic ? "Published — anyone with the link can view it. Click to unpublish." : "Publish to the public gallery"}
          aria-pressed={!!c.isPublic}
          onClick={() => void onPublish(c)}
        >
          {c.isPublic ? <Globe /> : <Lock />}
        </Button>

        <Select
          value={c.campaignId ?? UNGROUPED}
          onValueChange={(v) => void onMove(c.id, v === UNGROUPED ? null : v)}
        >
          <SelectTrigger
            className="size-7 shrink-0 justify-center border-0 bg-transparent p-0 opacity-100 shadow-none transition-opacity hover:bg-accent md:opacity-0 md:group-hover:opacity-100"
            aria-label={`Move ${c.name} to a campaign`}
            title="Move to campaign"
          >
            <Layers3 className="size-4 text-muted-foreground" />
            <SelectValue className="hidden" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNGROUPED}>No campaign</SelectItem>
            {campaigns.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          title="Export JSON"
          disabled={busyId === c.id}
          onClick={() => void onExport(c)}
        >
          <FileDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          title="Delete"
          onClick={() => void onDelete(c.id)}
        >
          <Trash2 />
        </Button>
      </div>
    );
  }

  const empty = configs.length === 0 && campaigns.length === 0;

  return (
    <Section
      title="Archive"
      count={configs.length}
      open={open}
      onToggle={onToggle}
      fill
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          title="New campaign"
          aria-label="New campaign"
          onClick={() => { setCreating((v) => !v); setDraftName(""); setRenaming(null); }}
        >
          <FolderPlus />
        </Button>
      }
    >
      {creating && (
        <div className="flex gap-1.5 pb-1">
          <Input
            className="h-8"
            autoFocus
            value={draftName}
            placeholder="Campaign name"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void onCreateCampaign(); }
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <Button size="sm" className="h-8" onClick={() => void onCreateCampaign()} disabled={!draftName.trim()}>
            Create
          </Button>
        </div>
      )}

      {empty ? (
        <Hint>Nothing in the archive yet. <span className="text-foreground">Save</span> to archive the current project.</Hint>
      ) : (
        <div className="space-y-1.5">
          {campaigns.map((g) => {
            const designs = groups.byCampaign.get(g.id) ?? [];
            const expanded = !collapsed.has(g.id);
            return (
              <div key={g.id} className="space-y-0.5">
                {renaming === g.id ? (
                  <div className="flex gap-1.5">
                    <Input
                      className="h-8"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void onRenameCampaign(g.id); }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <Button size="sm" className="h-8" onClick={() => void onRenameCampaign(g.id)}>Save</Button>
                  </div>
                ) : (
                  <div className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent/40"
                      onClick={() => toggle(g.id)}
                      aria-expanded={expanded}
                    >
                      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        {g.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{designs.length}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                      title="Download every design as a ZIP"
                      aria-label={`Download ${g.name} as a ZIP`}
                      disabled={designs.length === 0}
                      onClick={() => onExportCampaign({ id: g.id, name: g.name })}
                    >
                      <Package />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                      title="Rename campaign"
                      onClick={() => { setRenaming(g.id); setDraftName(g.name); setCreating(false); }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                      title="Delete campaign (the designs stay)"
                      onClick={() => void onDeleteCampaign(g.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}

                {expanded &&
                  (designs.length > 0 ? (
                    <div className="space-y-0.5 border-l border-border/60 pl-1.5">
                      {designs.map((c) => <ProjectRow key={c.id} c={c} campaignName={g.name} />)}
                    </div>
                  ) : (
                    <p className="pl-5 text-[11px] text-muted-foreground">Empty.</p>
                  ))}
              </div>
            );
          })}

          {groups.loose.length > 0 && (
            <div className="space-y-0.5">
              {campaigns.length > 0 && (
                <div className="px-1.5 pt-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                  No campaign
                </div>
              )}
              {groups.loose.map((c) => <ProjectRow key={c.id} c={c} />)}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => exportConfigFile(doc, projectName || "thumb")}>
          <FileDown /> Export project
        </Button>
        <UploadButton label="Import from file" icon={<FileUp />} accept="application/json,.json" className="w-full justify-center" onFile={(f) => void onImport(f)} />
      </div>
    </Section>
  );
}

/** What a guest gets in place of the archive: the designs marked public, and one action per
 *  row. Opening one adopts it with a **null id** — a guest holds a local copy, not the
 *  project, and nothing here can write. The JSON export/import stay, because both are entirely
 *  client-side and are how a guest takes their work with them. */
function PublicGallery({ doc, projectName, onLoad, onError, refreshKey, open, onToggle }: Props) {
  const [items, setItems] = useState<PublicConfigMeta[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listPublicConfigs()
      .then(setItems)
      .catch(() => onError("Couldn't read the gallery."));
  }, [refreshKey]);

  // Campaigns aren't published separately — the grouping is derived from whichever published
  // designs happen to share one, so an unpublished sibling never reveals itself as a gap.
  const groups = useMemo(() => {
    const out = new Map<string, PublicConfigMeta[]>();
    for (const c of items) {
      const key = c.campaignName ?? "";
      const list = out.get(key);
      list ? list.push(c) : out.set(key, [c]);
    }
    return [...out.entries()];
  }, [items]);

  async function onOpen(c: PublicConfigMeta) {
    setBusyId(c.id);
    try {
      const full = await loadPublicConfig(c.id);
      onLoad(full.doc, full.name, null, null);
      onError("");
    } catch {
      onError("Couldn't load the design.");
    } finally {
      setBusyId(null);
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const { name, doc: imported } = await importConfigFile(file);
      onLoad(imported, name ?? "Untitled", null, null);
      onError("");
    } catch {
      onError("Invalid JSON file.");
    }
  }

  return (
    <Section title="Gallery" count={items.length} open={open} onToggle={onToggle} fill>
      {items.length === 0 ? (
        <Hint>No designs have been published yet.</Hint>
      ) : (
        <div className="space-y-1.5">
          {groups.map(([campaignName, designs]) => (
            <div key={campaignName || "__loose__"} className="space-y-0.5">
              {campaignName && (
                <div className="px-1.5 pt-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                  {campaignName}
                </div>
              )}
              {designs.map((c) => {
                const prefixed = !!campaignName && c.name.startsWith(`${campaignName} — `);
                const shown = prefixed ? c.name.slice(campaignName.length + 3) : c.name;
                const fmt = !prefixed && c.format && FORMATS[c.format] ? `${FORMATS[c.format].label} · ` : "";
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
                    title="Open a copy"
                    disabled={busyId === c.id}
                    onClick={() => void onOpen(c)}
                  >
                    <span className="grid h-7 w-12 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-black/40 ring-1 ring-border/70">
                      {c.preview ? (
                        <img
                          src={publicBlobUrl(c.id, c.preview)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <FolderOpen className="size-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-tight">{shown}</span>
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {fmt}
                        {relTime(c.updatedAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <Hint>Opening a design gives you your own copy to play with. Export it to keep it.</Hint>

      <div className="flex flex-col gap-2 pt-1">
        <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => exportConfigFile(doc, projectName || "thumb")}>
          <FileDown /> Export project
        </Button>
        <UploadButton label="Import from file" icon={<FileUp />} accept="application/json,.json" className="w-full justify-center" onFile={(f) => void onImport(f)} />
      </div>
    </Section>
  );
}
