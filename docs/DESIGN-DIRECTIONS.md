# Interface direction

## Current system: Riverbank (selected 2026-07-31)

Superseded the *Working almanac* system recorded below. The reason was concrete
rather than aesthetic: the product had **three** palettes that shared no hues.
Pip is burnt orange, teal and gold outlined in deep teal-navy. The web edition
was cream, sage, dusty rose and olive ink. The Mac edition was lavender
(`#735FC7`) and mint, with a lavender-gradient app mark. The mascot read as a
sticker applied after the fact, because that is what he was.

The palette is now sampled from the artwork, so every value in the product
exists somewhere on the mascot.

| Token | Value | Meaning |
|---|---|---|
| Paper | `#FDF6E8` | Ground. Already Pip's — his eye-whites and the card he holds |
| Canvas | `#F7EEDD` | Window background, a shade under paper so raised surfaces read |
| Gold | `#F9B233` | Needs a look. His belly |
| Orange | `#F26522` | **You act here.** His body. Primary actions only |
| Teal | `#1B9AAE` | **Sensed, not read.** His bill and feet |
| Deep teal | `#0E7182` | Held private — never leaves the machine |
| Ink | `#123A47` | Body text, rules, hairlines. **His outline** |

**The neutral is not grey.** Pip is outlined in deep teal-navy, never black.
Every rule, border and line of body text inherits that hue, which is why the
interface reads as belonging to him on screens where he does not appear.

**Orange and teal carry different jobs and must not be swapped.** Orange means
a control you operate; teal means information derived from opaque provider data
— free/busy, availability, anything sensed rather than read. A teal primary
button would blur the one distinction the product exists to make.

- **Type:** `Superclarendon` display, `Seravek` body, `SF Mono` for times,
  counts and reason codes. All ship with macOS; no webfont is fetched on either
  edition, so nothing phones home.
- **Signature:** *disclosure depth*. How far a band sits from the surface **is**
  its privacy tier, so the model is legible without a legend. Implemented as
  `DisclosureDepth` in `PlanipusDesign`.
- **Borrowed treatment:** the bridge preview screen — and only that screen —
  uses a dark *sensing field*: events as pulses on a teal-navy ground, position
  and duration with no titles. It is the one place where "we can tell something
  is here without reading it" does real explanatory work.
- **Pip has three jobs:** Dock icon, empty states, and status poses
  (idle / syncing / attention). He is not a chat avatar and never narrates.
- **The menu-bar glyph is a monochrome silhouette, never full-colour Pip**, and
  it is additionally reserved as the local control-plane indicator, which
  signals by changing *shape* rather than tint (ADR-006).

Accessibility target: WCAG 2.2 AA, full keyboard operation, visible focus,
patterns and text in addition to colour, and a useful narrow-screen agenda view.
Status is never conveyed by colour alone; every lozenge carries a word.

### Tokens live in two places, deliberately

`web/src/styles.css` and `macos/Sources/PlanipusDesign/PlanipusDesign.swift`
carry the same values. The editions share no build step, so a colour change
means editing both. That duplication is the cost of edition autonomy and is
accepted; a shared asset pipeline would be the first thread of a shared runtime.

### Directions considered, 2026-07-31

| Direction | Signature | Why not |
|---|---|---|
| **Riverbank (selected)** | Disclosure as depth in water | — |
| Electrosense | Dark sensing field; events as pulses, never titles | Most on-metaphor and most memorable, but heavy for a tool opened a dozen times a day. Adopted for the preview screen only |
| Field notebook | Naturalist's specimen label, stamped status | Cheapest to adopt and closest to what shipped, but it keeps the warm-cream editorial look that made Pip feel bolted on |

---

## Superseded: Working almanac (2026-07-21 – 2026-07-31)

Retained for provenance. Three directions were compared before markup was
written.

| Direction | Character | Strength | Risk |
|---|---|---|---|
| Observatory | Near-black operations console, luminous event lanes, dense live telemetry | Excellent for administrators and solver inspection | Too severe for daily personal planning |
| Transit board | White/black modular grid, route colors, timetable typography | Calendar relationships are instantly legible | Can feel rigid and municipal |
| Working almanac **(then selected)** | Warm paper, ink-blue rules, bookish headings, stamped status labels | Calm, distinctive, and supports dense weekly decisions | Requires disciplined spacing to avoid nostalgia |

Its palette was canvas `#f3efe4`, ink `#15263b`, risk `#c94d32`, protected
`#99c2ad`, task `#e5b85c`, fixed event `#7894b0`. The risk noted at the time —
that it required discipline to avoid nostalgia — was not what went wrong. What
went wrong is that it was chosen before the mascot existed and never
reconciled with him.
