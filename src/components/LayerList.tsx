import type { Dispatch, ReactNode } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Image as ImageIcon, Smile, Square, Trash2, Type } from "lucide-react";
import type { Action, Layer, LayerType } from "../state";
import { Button } from "./ui/button";
import { Hint } from "./controls";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<LayerType, ReactNode> = {
  text: <Type className="size-3.5" />,
  image: <ImageIcon className="size-3.5" />,
  emoji: <Smile className="size-3.5" />,
  shape: <Square className="size-3.5" />,
};

type Props = { layers: Layer[]; selectedId: string | null; dispatch: Dispatch<Action> };

/** Layer stack, shown front-first (top of the list = frontmost on the canvas). */
export function LayerList({ layers, selectedId, dispatch }: Props) {
  if (layers.length === 0) return <Hint>Nessun livello. Aggiungine uno qui sopra o carica un modello.</Hint>;

  return (
    <div className="space-y-1">
      {layers
        .map((layer, index) => ({ layer, index }))
        .reverse()
        .map(({ layer, index }) => {
          const front = index === layers.length - 1;
          const back = index === 0;
          const active = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              onClick={() => dispatch({ type: "select", id: layer.id })}
              className={cn(
                "flex cursor-pointer items-center gap-0.5 rounded-md border px-1.5 py-1 text-sm transition-colors",
                active ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:bg-accent"
              )}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground [&_svg]:size-3.5"
                title={layer.visible ? "Nascondi" : "Mostra"}
                onClick={(e) => { e.stopPropagation(); dispatch({ type: "updateLayer", id: layer.id, patch: { visible: !layer.visible } }); }}
              >
                {layer.visible ? <Eye /> : <EyeOff />}
              </Button>
              <span className="text-muted-foreground">{TYPE_ICON[layer.type]}</span>
              <span className="flex-1 truncate px-1">{layer.name}</span>
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
          );
        })}
    </div>
  );
}
