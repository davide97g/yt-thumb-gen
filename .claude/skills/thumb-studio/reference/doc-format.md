# ThumbDoc field reference

Condensed from `src/state.ts`. For the authoritative contract call `get_doc_schema`.

```jsonc
{
  "format": "youtube",        // youtube | shorts | ig-post | ig-reel | linkedin
  "background": { … },
  "layers": [ … ]             // index 0 paints first (backmost)
}
```

All three top-level keys are required.

## Everything is required unless marked optional

**There are no server-side defaults.** A layer missing one key is rejected whole — and with
`THUMBDOC_VALIDATE=enforce` that rejection is fatal, not a warning. The traps that bite most
often, all required even when they do nothing:

- `bg` on **every** `text` layer, even a plain unhighlighted one → `{ "enabled": false, "color":
  "#000000", "padX": 16, "padY": 8, "radius": 12 }`
- `pct` and `trackColor` on **every** `shape`, not just `bar` → `0` and any colour
- `brand` and `brandColor` on **every** `image`, even a plain photo → `null` and any colour
- `image` on `background`, even for a gradient → `null`

Nested objects are all-or-nothing too: pass `bg`, `crop`, `mask` or `border` and you must pass
*every* sub-key.

**The fix is not to memorise this: call `new_layer`.** It returns a complete, valid layer for the
kind you ask for, and you edit fields from there. The lists below are for reading a doc you
didn't write, or for debugging a rejection.

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

Required: `mode` `from` `to` `image` `overlay`.

```jsonc
{
  "mode": "gradient",         // gradient | solid | image | effect
  "from": "#0d1b13",          // gradient start; the fill when mode is "solid"
  "to": "#04070a",
  "image": null,              // required key — you cannot set a value, there is no upload path
  "overlay": 0,               // 0–100 scrim darkness. Raise for text legibility.
```

Optional: `imageX` `imageY` `imageZoom` (framing, only meaningful with an image), the colour
grade, `border`, and `effect`.

```jsonc
  // optional colour grade, painted over every layer
  "gradeTint": "#ff9ffc", "gradeAmount": 0,   // 0–100
  "gradeBlend": "soft-light",                  // | overlay | multiply | screen | color
  "gradeVignette": 0, "gradeGrain": 0,         // 0–100

  // optional full-canvas frame — if present, all 7 sub-keys are required
  "border": { "enabled": false, "color": "#000000", "width": 24,
              "radius": 32, "style": "solid", "inset": 0, "opacity": 100 },

  "effect": { … }             // required when mode is "effect"; see below
}
```

## Every layer

Required on all types: `id` (unique string), `type`, `name` (shown in the layer list), `x`, `y`
(top-left), `rotation` (degrees), `visible`. There is no nesting.

Optional on all types: `groupId` (logical grouping only — it does not affect paint order).

### `text`

Required: `text` (`\n` for line breaks), `font`, `size`, `color`, `align` (left|center|right),
`lineHeight`, `opacity` (0–100), `stroke`, `strokeWidth`, `strokeColor`, `shadow`, **`bg`**.

`bg: { enabled, color, padX, padY, radius }` — all five sub-keys required. Set `enabled: true` to
turn the layer into a badge/pill; pass it with `enabled: false` for ordinary text.

Optional: `fx`, one of:
- `{ "kind": "none" }`
- `{ "kind": "gradient", "colors": ["#a","#b","#c"], "speed": 8, "direction": "horizontal|vertical|diagonal" }` — exactly 3 colours
- `{ "kind": "shiny", "color", "shineColor", "spread": 120, "speed": 2, "direction": "left|right" }`
- `{ "kind": "glitch", "speed": 1, "color1", "color2", "enableShadows": true }`

Fonts: `archivo` `inter` `georgia` `mono` `bebas` `anton` `oswald` `leagueGothic` `leagueSpartan`
`montserrat` `poppins` `robotoCondensed` `luckiestGuy` `bangers` `sfpro` `helvetica` `segoe`
`crimsonPro` `geistMono` `libreBaskerville` `lobster` `spaceGrotesk` `anthropicSans`.
Heavy display faces (`anton`, `archivo`, `bebas`, `luckiestGuy`) read best at thumbnail size.

There is **no letter-spacing field**. To fake wide tracking, put spaces between characters.

### `image`

Required: `src`, `origSrc`, **`brand`**, **`brandColor`**, `scale` (1 = 360px wide), `opacity`,
`flip`, `radius`, `ring`, `ringColor`, `glow`, `glowStyle` (glow|line), `glowColor`, `glowSize`.

`src` and `origSrc` must stay `null` — you have no upload path. A layer with `src: null` renders
as a grey `carica foto →` slot sized `360 × scale` wide by 1.2× that tall, which is the correct
way to leave a placeholder for the user. Set `brand` to `"logo"` or `"wordmark"` for the built-in
Claude marks (overrides `src`, needs no upload), otherwise pass `brand: null`.

Optional: `brightness`/`contrast`/`saturation` (%, 100 = neutral), `crop` (`{l,t,r,b}`, all four
required), `mask` (`{points}`, required).

Border options (all optional, only read when `ring` is true): `ringStyle` (`solid`|`gradient`,
default solid), `ringColors` (exactly 4 hex stops for the gradient, default the iridescent
purple→blue→cyan→green set), `ringAngle` (deg, default 135), `ringWidth` (px, default 10),
`ringGlow` (blur px of the same border repeated behind the picture, default 0 = off).

### `emoji`
Required: `glyph`, `size`.

### `shape`
Required: `kind` (`rect` | `pill` | `bar`), `fill`, `w`, `h`, `radius`, **`pct`**, **`trackColor`**.

`radius` is ignored for pill/bar; `pct` (0–100 watched fraction) and `trackColor` are only *used*
by `bar` but are required on all three kinds. A circle is a `rect` with `radius` = half its width.
`bar` is the fake YouTube progress bar — full width, near the bottom edge.

### `draw`
Required: `points` (bbox-relative), `rawW`, `rawH`, `scale`, `color`, `thickness`, `lineStyle`
(solid|dashed|dotted), `smoothing` (0–100), `startCap`, `endCap` (none|arrow|dot|tee).
Use `new_layer` — the bbox maths is easy to get wrong.

### `effect`
Required: `w`, `h`, `radius`, `effect` — an animated panel using the same presets as the
background.

### `emojifx`
A field of emoji around an image layer. Required: `targetId`, `pattern` (ring|scatter|burst),
`glyphs[]`, `count`, `size`, `sizeJitter`, `radius`, `tilt`, `depth`, `spin`, `seed`.

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
