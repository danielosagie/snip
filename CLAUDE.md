# snip

Video review + contracts + paywalled delivery for creative teams. Forked from
lawn; the upstream repo at `pingdotgg/lawn` is still the origin remote.

## Design Language

> **Exception — marketing landing page.** `app/routes/-home.tsx` intentionally
> uses a different, shade.inc-inspired art direction (white background, Inter
> Tight sentence-case display type with a gray second line, mono `▶ EYEBROW`
> labels, pill buttons, rounded bento cards, dark rounded CTA panel). Do not
> "fix" it back to the brutalist language below — that language applies to the
> app UI and the other marketing pages.

### Philosophy
Brutalist, typographic, minimal. The design should feel bold and direct—like a
poster, not a dashboard. Prioritize clarity over decoration. Let typography and
whitespace do the heavy lifting.

### Colors
- **Background**: `#f0f0e8` (warm cream)
- **Text**: `#1a1a1a` (near-black)
- **Muted text**: `#888888`
- **Primary accent**: `#C2410C` (burnt orange — the snip mark dot)
- **Accent hover**: `#9A3412` (deeper burnt orange)
- **Highlight wash**: `#FDBA74` (light orange for tinted backgrounds)
- **Subtle wash**: `#FFEDD5` (very light orange for hover cells)
- **Borders**: `#1a1a1a` (strong) or `#ccc` (subtle)
- **Inverted sections**: `#1a1a1a` background with `#f0f0e8` text

### Typography
- **Headings**: Font-black (900 weight), tight tracking
- **Body**: Regular weight, clean and readable
- **Monospace**: For technical info, timestamps, stats
- Use size contrast dramatically—massive headlines with small supporting text

### Borders & Spacing
- Strong 2px borders in `#1a1a1a` for section dividers and cards
- Generous padding (p-6 to p-8 typical)
- Clear visual hierarchy through spacing

### Interactive Elements
- Buttons: 2px black border, brutalist `shadow-[4px_4px_0px_0px_var(--shadow-color)]`
  drop-shadow, press-down hover (`translate-y-[2px] translate-x-[2px]` with the
  shadow shrinking to 2px). The Button component's `outline` variant is the
  reference look — every top-bar control should match its height (`h-9` for
  packed strips, `h-10` for default).
- Links: Underlines, not color-only differentiation
- Hover states: Background fills or color shifts, no subtle opacity changes

### Component Patterns
- **Cards**: 2px black border, cream background, bold title
- **Sections**: Often alternate between cream and dark backgrounds
- **Forms**: Simple inputs with strong borders, no rounded corners or minimal
- **Navigation**: Minimal, text-based, appears on scroll when needed

### Do's
- Use bold typography to create hierarchy
- Embrace whitespace
- Keep interactions obvious and direct
- Use orange sparingly as accent, not as a fill — it's a punctuation color

### Don'ts
- No gradients (except inside the hero hero photo); subtle drop-shadows are
  fine when they're functional (brutalist 4px offset)
- No rounded corners on primary UI (square/sharp edges)
- No decorative icons—only functional ones
- Don't hide information behind hover states

## Branding notes

- Wordmark is `snip` with the period in `#C2410C`: `snip<span class="text-[#C2410C]">.</span>`
- Logo asset is `public/grass-logo.svg` — Lucide Film icon on the snip
  orange, matching `public/favicon.svg`. Same mark renders as the
  favicon, the macOS app icon (`desktop/resources/icon.icns` is
  generated from this file by `desktop/scripts/generate-dmg-assets.sh`
  at CI time), and any in-product logo surface. Filename is kept
  stable to avoid breaking static references — replace the contents,
  not the path.
- Bulk rebrand happened via sed. The remaining `lawn` linkage has since been
  scrubbed:
  - `localStorage` keys are now `snip-theme`, `snip:sidebar:collapsed`,
    `snip.presence.client_id`. The readers still fall back to the old `lawn-*`
    keys once so existing users don't lose their preferences — that fallback
    can be dropped later.
  - Public GitHub links point to `github.com/danielosagie/snip`. (The git
    `origin` remote may still be `pingdotgg/lawn`; that's a local git config,
    not a source reference.)
