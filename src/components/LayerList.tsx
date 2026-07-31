import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, GripVertical, Image as ImageIcon, Link2, PartyPopper, Pencil, Smile, Sparkles, Square, Star, Trash2, Type } from "lucide-react";
import type { Action, Layer, LayerType } from "../state";
import { Button } from "./ui/button";
import { Hint } from "./controls";
import { cn } from "@/lib/utils";

export const TYPE_ICON: Record<LayerType, ReactNode> = {
  text: <Type className="size-3.5" />,
  image: <ImageIcon className="size-3.5" />,
  emoji: <Smile className="size-3.5" />,
  shape: <Square className="size-3.5" />,
  effect: <Sparkles className="size-3.5" />,
  draw: <Pencil className="size-3.5" />,
  emojifx: <PartyPopper className="size-3.5" />,
};

type Props = { layers: Layer[]; selectedIds: string[]; dispatch: Dispatch<Action>; onStar: (layer: Layer) => void };

const DRAG_THRESHOLD = 4; // px before a press becomes a drag, so clicks still select
const EDGE = 48; // distance from the scroller edge where auto-scroll kicks in
const EDGE_SPEED = 14; // px per frame at the very edge

/** Nearest scrollable ancestor — the layer rail scrolls, and a drag has to be able to
 *  reach layers that are currently off-screen. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Layer stack, shown front-first (top of the list = frontmost on the canvas).
 *
 *  Rows are drag-reorderable (hand-rolled with pointer events, like the canvas). A drag
 *  carries the whole selection, so several layers move as a block with their relative
 *  order intact. Selection follows the usual modifiers: plain click replaces, ⌘/Ctrl
 *  toggles one row, Shift extends from the last clicked row. */
export function LayerList({ layers, selectedIds, dispatch, onStar }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // Drag ids + the live drop gap (visual slot, and its y for the indicator line).
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<{ slot: number; y: number } | null>(null);
  // Press that hasn't crossed the threshold yet; null once it has (or was never a drag).
  const pendRef = useRef<{ y: number; ids: string[] } | null>(null);
  const dragRef = useRef<string[] | null>(null);
  const dropRef = useRef<{ slot: number; y: number } | null>(null);
  const movedRef = useRef(false); // swallow the click that ends a drag
  const anchorRef = useRef<string | null>(null); // Shift-range anchor
  // Auto-scroll loop state: latest pointer y + the rAF handle.
  const yRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // The list is capped to the rail's leftover height, so a layer picked on the canvas can
  // easily sit outside the visible window. Bring it back — but never mid-drag, which runs
  // its own edge scrolling.
  const selectionKey = selectedIds.join(",");
  useEffect(() => {
    if (dragRef.current) return;
    const id = selectedIds[selectedIds.length - 1];
    if (!id) return;
    listRef.current?.querySelector(`[data-layer-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectionKey]);

  if (layers.length === 0) return <Hint>Nessun livello. Aggiungine uno qui sopra o carica un modello.</Hint>;

  const groupMates = (layer: Layer): string[] =>
    layer.groupId ? layers.filter((l) => l.groupId === layer.groupId).map((l) => l.id) : [layer.id];

  // Which gap the pointer is over, measured live so it stays right while the rail scrolls.
  function dropAt(clientY: number): { slot: number; y: number } {
    const c = listRef.current;
    if (!c) return { slot: 0, y: 0 };
    const cTop = c.getBoundingClientRect().top;
    const rows = [...c.querySelectorAll<HTMLElement>("[data-layer-row]")].map((r) => r.getBoundingClientRect());
    if (!rows.length) return { slot: 0, y: 0 };
    const slot = rows.filter((r) => clientY > r.top + r.height / 2).length;
    return { slot, y: (slot === 0 ? rows[0].top : rows[slot - 1].bottom) - cTop };
  }

  function setDropFrom(clientY: number) {
    const next = dropAt(clientY);
    if (next.slot !== dropRef.current?.slot || next.y !== dropRef.current?.y) {
      dropRef.current = next;
      setDrop(next);
    }
  }

  function autoScroll() {
    rafRef.current = requestAnimationFrame(autoScroll);
    const sc = scrollParent(listRef.current);
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    const y = yRef.current;
    let v = 0;
    if (y < r.top + EDGE) v = -EDGE_SPEED * Math.min(1, (r.top + EDGE - y) / EDGE);
    else if (y > r.bottom - EDGE) v = EDGE_SPEED * Math.min(1, (y - (r.bottom - EDGE)) / EDGE);
    if (!v) return;
    const before = sc.scrollTop;
    sc.scrollTop += v;
    if (sc.scrollTop !== before) setDropFrom(y);
  }

  function onRowPointerDown(e: React.PointerEvent<HTMLDivElement>, layer: Layer) {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest("button")) return; // row actions keep working
    // Touch/pen must drag from the grip, otherwise a swipe could never scroll the rail.
    if (e.pointerType !== "mouse" && !el.closest("[data-drag-handle]")) return;

    // Dragging an unselected row drags that row (plus its group); dragging a selected
    // one carries the whole selection.
    const mates = groupMates(layer);
    const ids = mates.every((m) => selectedIds.includes(m)) ? selectedIds : mates;
    pendRef.current = { y: e.clientY, ids };
    movedRef.current = false;
    yRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onRowPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    yRef.current = e.clientY;
    const pend = pendRef.current;
    if (pend) {
      if (Math.abs(e.clientY - pend.y) < DRAG_THRESHOLD) return;
      pendRef.current = null;
      movedRef.current = true;
      dragRef.current = pend.ids;
      setDragIds(pend.ids);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(autoScroll);
    }
    if (!dragRef.current) return;
    e.preventDefault(); // no text selection while dragging
    setDropFrom(e.clientY);
  }

  function endDrag() {
    cancelAnimationFrame(rafRef.current);
    const ids = dragRef.current;
    const slot = dropRef.current?.slot;
    dragRef.current = null;
    dropRef.current = null;
    pendRef.current = null;
    setDragIds(null);
    setDrop(null);
    // The list paints front-first, so visual slot 0 is the gap in *front* of everything:
    // gap in doc order = layers.length - slot.
    if (ids && slot !== undefined) dispatch({ type: "moveLayers", ids, toIndex: layers.length - slot });
  }

  function onRowClick(e: React.MouseEvent, layer: Layer, index: number) {
    if (movedRef.current) { movedRef.current = false; return; } // this click ended a drag
    const mates = groupMates(layer);

    if (e.shiftKey && anchorRef.current) {
      const a = layers.findIndex((l) => l.id === anchorRef.current);
      if (a >= 0) {
        const [lo, hi] = a < index ? [a, index] : [index, a];
        // Group mates come along even if they sit outside the range — groups select whole.
        dispatch({ type: "select", ids: [...new Set(layers.slice(lo, hi + 1).flatMap(groupMates))] });
        return; // Shift keeps the anchor where it was
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const has = mates.every((m) => selectedIds.includes(m));
      dispatch({
        type: "select",
        ids: has ? selectedIds.filter((s) => !mates.includes(s)) : [...selectedIds, ...mates.filter((m) => !selectedIds.includes(m))],
      });
    } else {
      dispatch({ type: "select", ids: mates });
    }
    anchorRef.current = layer.id;
  }

  return (
    // Hairlines instead of one card per layer: the stack reads as a single list,
    // and the selected row is marked by its terracotta tick, not by a border.
    // `relative` so the drop indicator can float over the rows without shifting them.
    <div ref={listRef} className={cn("relative -mx-1.5 divide-y divide-border/45", dragIds && "select-none")}>
      {drop && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-px rounded-full bg-primary"
          style={{ top: drop.y }}
        />
      )}
      {layers
        .map((layer, index) => ({ layer, index }))
        .reverse()
        .map(({ layer, index }) => {
          const front = index === layers.length - 1;
          const back = index === 0;
          const active = selectedIds.includes(layer.id);
          const dragging = dragIds?.includes(layer.id) ?? false;
          return (
            <div
              key={layer.id}
              data-layer-row
              data-layer-id={layer.id}
              onPointerDown={(e) => onRowPointerDown(e, layer)}
              onPointerMove={onRowPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => onRowClick(e, layer, index)}
              className={cn(
                "group/row relative flex cursor-pointer items-center gap-1.5 py-2 pl-1 pr-1.5 text-[13px] transition-colors",
                active ? "layer-accent bg-primary/10 text-foreground" : "hover:bg-accent",
                !layer.visible && "opacity-55",
                dragging && "opacity-40"
              )}
            >
              <span
                data-drag-handle
                className="shrink-0 cursor-grab touch-none px-0.5 text-muted-foreground/35 transition-colors group-hover/row:text-muted-foreground/70 active:cursor-grabbing"
                title="Trascina per riordinare"
                aria-hidden
              >
                <GripVertical className="size-3" />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 text-muted-foreground [&_svg]:size-3.5"
                title={layer.visible ? "Nascondi" : "Mostra"}
                onClick={(e) => { e.stopPropagation(); dispatch({ type: "updateLayer", id: layer.id, patch: { visible: !layer.visible } }); }}
              >
                {layer.visible ? <Eye /> : <EyeOff />}
              </Button>
              <span className="flex shrink-0 items-center gap-1">
                <span className={active ? "text-primary" : "text-muted-foreground"}>{TYPE_ICON[layer.type]}</span>
                {layer.groupId && <Link2 className="size-3 text-muted-foreground" aria-label="Raggruppato" />}
              </span>
              {/* The name gets the whole remaining row at rest — the actions float over it
                  on hover instead of reserving a gutter, so nothing re-truncates mid-hover.
                  On touch (no hover) they're always out, so the gutter is reserved there. */}
              <span className="min-w-0 flex-1 truncate pl-0.5 pr-[5.75rem] md:pr-0" title={layer.name}>
                {layer.name}
              </span>
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border/70 bg-card px-1 py-0.5 shadow-sm transition-opacity duration-150 pointer-events-auto md:pointer-events-none md:opacity-0 md:group-hover/row:pointer-events-auto md:group-focus-within/row:pointer-events-auto md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
                {/* Reordering is one instrument; saving, copying and deleting are another.
                    The pair is desktop-only: on touch it's always on screen, and those two
                    buttons cost the layer name a third of the row — dragging the grip does
                    the same job with the finger. */}
                <span className="hidden items-center gap-0.5 md:flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 [&_svg]:size-3.5"
                    disabled={front}
                    title="Porta avanti"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: "reorder", id: layer.id, dir: 1 }); }}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 [&_svg]:size-3.5"
                    disabled={back}
                    title="Porta indietro"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: "reorder", id: layer.id, dir: -1 }); }}
                  >
                    <ChevronDown />
                  </Button>
                  <span className="mx-0.5 h-4 w-px bg-border/70" aria-hidden />
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground hover:text-amber-400 [&_svg]:size-3.5"
                  title="Aggiungi ai preferiti"
                  onClick={(e) => { e.stopPropagation(); onStar(layer); }}
                >
                  <Star />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground [&_svg]:size-3.5"
                  title="Duplica"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "select", ids: [layer.id] }); dispatch({ type: "pasteLayer", layer }); }}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                  title="Elimina"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "removeLayer", id: layer.id }); }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
