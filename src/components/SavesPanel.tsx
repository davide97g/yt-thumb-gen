import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { EmptyPond } from "./ui/empty-pond";
import { GlowInput } from "./ui/glow-input";
import { hudLabelVariants } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { StickerTooltip } from "./ui/sticker-tooltip";
import { cn, relTime } from "@/lib/utils";

/** A row's trailing action: ghost QuackButton, no ripple (a list of forty of them
    splashing is noise), labelled by a tooltip rather than a `title`. */
function RowIcon({
  label, onClick, disabled, className, pressed, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <StickerTooltip content={label} delay={500}>
      <QuackButton
        variant="ghost"
        size="icon"
        ripple={false}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn("size-7 shrink-0 rounded-md text-muted-foreground [&_svg]:size-3.5", className)}
      >
        {children}
      </QuackButton>
    </StickerTooltip>
  );
}

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

        <RowIcon
          label={c.isPublic ? "Published — click to unpublish" : "Publish to the public gallery"}
          pressed={!!c.isPublic}
          className={cn(
            "transition-opacity",
            c.isPublic
              ? "text-primary opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          )}
          onClick={() => void onPublish(c)}
        >
          {c.isPublic ? <Globe /> : <Lock />}
        </RowIcon>

        <Select
          value={c.campaignId ?? UNGROUPED}
          onValueChange={(v) => void onMove(c.id, v === UNGROUPED ? null : v)}
        >
          <SelectTrigger
            frame={false}
            chevron={false}
            className="size-7 shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
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

        <RowIcon
          label="Export JSON"
          className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          disabled={busyId === c.id}
          onClick={() => void onExport(c)}
        >
          <FileDown />
        </RowIcon>
        <RowIcon
          label="Delete"
          className="opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          onClick={() => void onDelete(c.id)}
        >
          <Trash2 />
        </RowIcon>
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
        <RowIcon
          label="New campaign"
          onClick={() => { setCreating((v) => !v); setDraftName(""); setRenaming(null); }}
        >
          <FolderPlus />
        </RowIcon>
      }
    >
      {creating && (
        <div className="flex gap-1.5 pb-1">
          <GlowInput
            className="h-8"
            autoFocus
            value={draftName}
            aria-label="Campaign name"
            placeholder="Campaign name"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void onCreateCampaign(); }
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <QuackButton size="sm" onClick={() => void onCreateCampaign()} disabled={!draftName.trim()}>
            Create
          </QuackButton>
        </div>
      )}

      {empty ? (
        <EmptyPond compact title="Nothing archived yet" hint="Press Save to put the current project in the archive." />
      ) : (
        <div className="space-y-1.5">
          {campaigns.map((g) => {
            const designs = groups.byCampaign.get(g.id) ?? [];
            const expanded = !collapsed.has(g.id);
            return (
              <div key={g.id} className="space-y-0.5">
                {renaming === g.id ? (
                  <div className="flex gap-1.5">
                    <GlowInput
                      className="h-8"
                      autoFocus
                      value={draftName}
                      aria-label="Campaign name"
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void onRenameCampaign(g.id); }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <QuackButton size="sm" onClick={() => void onRenameCampaign(g.id)}>Save</QuackButton>
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
                      <span className={cn(hudLabelVariants({ size: "sm", tracking: "tight" }), "min-w-0 flex-1 truncate font-medium")}>
                        {g.name}
                      </span>
                      <span className={cn(hudLabelVariants({ size: "sm" }), "shrink-0 tabular-nums")}>{designs.length}</span>
                    </button>
                    <RowIcon
                      label={`Download ${g.name} as a ZIP`}
                      className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                      disabled={designs.length === 0}
                      onClick={() => onExportCampaign({ id: g.id, name: g.name })}
                    >
                      <Package />
                    </RowIcon>
                    <RowIcon
                      label="Rename campaign"
                      className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                      onClick={() => { setRenaming(g.id); setDraftName(g.name); setCreating(false); }}
                    >
                      <Pencil />
                    </RowIcon>
                    <RowIcon
                      label="Delete campaign (the designs stay)"
                      className="opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                      onClick={() => void onDeleteCampaign(g.id)}
                    >
                      <Trash2 />
                    </RowIcon>
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
                <div className={cn(hudLabelVariants({ size: "sm", tracking: "tight" }), "px-1.5 pt-1 font-medium")}>
                  No campaign
                </div>
              )}
              {groups.loose.map((c) => <ProjectRow key={c.id} c={c} />)}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <QuackButton variant="outline" size="sm" className="w-full" onClick={() => exportConfigFile(doc, projectName || "thumb")}>
          <FileDown /> Export project
        </QuackButton>
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
        <EmptyPond compact title="Nothing published yet" hint="Designs the owner publishes show up here." />
      ) : (
        <div className="space-y-1.5">
          {groups.map(([campaignName, designs]) => (
            <div key={campaignName || "__loose__"} className="space-y-0.5">
              {campaignName && (
                <div className={cn(hudLabelVariants({ size: "sm", tracking: "tight" }), "px-1.5 pt-1 font-medium")}>
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
        <QuackButton variant="outline" size="sm" className="w-full" onClick={() => exportConfigFile(doc, projectName || "thumb")}>
          <FileDown /> Export project
        </QuackButton>
        <UploadButton label="Import from file" icon={<FileUp />} accept="application/json,.json" className="w-full justify-center" onFile={(f) => void onImport(f)} />
      </div>
    </Section>
  );
}
