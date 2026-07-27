# ThumbDoc field reference

Condensed from `src/state.ts`. For the authoritative contract call `get_doc_schema`.

```jsonc
{
  "format": "youtube",        // youtube | shorts | ig-post | ig-reel | linkedin
  "background": { … },
  "layers": [ … ]             // index 0 paints first (backmost)
}
```

## Formats

| key | size | notes |
| --- | --- | --- |
| `youtube` | 1280×720 | 16:9. Export must stay under 2 MB. |
| `shorts` | 1080×1920 | 9:16 |
| `ig-post` | 1080×1350 | 4:5 |
| `ig-reel` | 1080×1920 | 9:16 |
| `linkedin` | 1080×1350 | 4:5 |

Templates are authored at 1280×720. Pass `format` to `get_template` to rescale.

## Background

```jsonc
{
  "mode": "gradient",         // gradient | solid | image | effect
  "from": "#0d1b13",          // gradient start; the fill when mode is "solid"
  "to": "#04070a",
  "image": null,              // you cannot set this — no upload path
  "overlay": 0,               // 0–100 scrim darkness. Raise for text legibility.

  // optional colour grade, painted over every layer
  "gradeTint": "#ff9ffc", "gradeAmount": 0,   // 0–100
  "gradeBlend": "soft-light",                  // | overlay | multiply | screen | color
  "gradeVignette": 0, "gradeGrain": 0,         // 0–100

  // optional full-canvas frame
  "border": { "enabled": false, "color": "#000000", "width": 24,
              "radius": 32, "style": "solid", "inset": 0, "opacity": 100 },

  "effect": { … }             // required when mode is "effect"; see below
}
```

## Every layer

Shared: `id` (unique string), `type`, `name` (shown in the layer list), `x`, `y` (top-left),
`rotation` (degrees), `visible`, optional `groupId`.

### `text`
`text` (\n for line breaks), `font`, `size`, `color`, `align` (left|center|right), `lineHeight`,
`opacity` (0–100), `stroke`, `strokeWidth`, `strokeColor`, `shadow`,
`bg: { enabled, color, padX, padY, radius }` — enable `bg` to turn the layer into a badge/pill.

Optional `fx`, one of:
- `{ "kind": "none" }`
- `{ "kind": "gradient", "colors": ["#a","#b","#c"], "speed": 8, "direction": "horizontal|vertical|diagonal" }` — exactly 3 colours
- `{ "kind": "shiny", "color", "shineColor", "spread": 120, "speed": 2, "direction": "left|right" }`
- `{ "kind": "glitch", "speed": 1, "color1", "color2", "enableShadows": true }`

Fonts: `archivo` `inter` `georgia` `mono` `bebas` `anton` `oswald` `leagueGothic` `leagueSpartan`
`montserrat` `poppins` `robotoCondensed` `luckiestGuy` `bangers` `sfpro` `helvetica` `segoe`
`crimsonPro` `geistMono` `libreBaskerville` `lobster` `spaceGrotesk` `anthropicSans`.
Heavy display faces (`anton`, `archivo`, `bebas`, `luckiestGuy`) read best at thumbnail size.

### `image`
`src` and `origSrc` must stay `null` — you have no upload path. Set `brand` to `"logo"` or
`"wordmark"` for the built-in Claude marks and give it a `brandColor`.
Also: `scale` (1 = base width), `opacity`, `flip`, `radius`, `ring`, `ringColor`, `glow`,
`glowStyle` (glow|line), `glowColor`, `glowSize`. Optional `brightness`/`contrast`/`saturation`
(%, 100 = neutral), `crop`, `mask`.

### `emoji`
`glyph`, `size`.

### `shape`
`kind` (`rect` | `pill` | `bar`), `fill`, `w`, `h`, `radius` (ignored for pill/bar),
`pct` (bar only, 0–100 watched fraction), `trackColor` (bar only).
`bar` is the fake YouTube progress bar — full width, near the bottom edge.

### `draw`
`points` (bbox-relative), `rawW`, `rawH`, `scale`, `color`, `thickness`,
`lineStyle` (solid|dashed|dotted), `smoothing` (0–100), `startCap`/`endCap`
(none|arrow|dot|tee). Use `new_layer` — the bbox maths is easy to get wrong.

### `effect`
`w`, `h`, `radius`, `effect` — an animated panel using the same presets as the background.

### `emojifx`
A field of emoji around an image layer: `targetId`, `pattern` (ring|scatter|burst), `glyphs[]`,
`count`, `size`, `sizeJitter`, `radius`, `tilt`, `depth`, `spin`, `seed`.

## Effect presets

- `grainient` — WebGL gradient. ~23 knobs (`color1..3`, `timeSpeed`, `warp*`, `grain*`, …).
- `aurora` — `color1..3`, `speed`, `blend`, `amplitude`.
- `mesh` — `color1..3`, `bgColor`, `softness`.
- `dots` — `dotColor`, `bgColor`, `size`, `gap`.

Get valid defaults from `new_layer` with `kind: "effect"` rather than writing these by hand.

## Size limits (advisory, not enforced)

`textSize` 4–4000 · `emojiSize` 8–4000 · `emojiFxSize` 8–2000 · `imageScale` 0.02–50 ·
`drawScale` 0.02–50 · shape/effect `w`/`h` 4–20000. Deliberately wide — a layer may exceed the
canvas.
