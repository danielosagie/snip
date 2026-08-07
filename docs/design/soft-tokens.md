# snip soft design language (Paper reference, Aug 6 2026)

Source of truth: the Paper export in `soft-reference-billing.tsx` (same folder).
This is the target look for the app shell, billing, team members, settings,
documents, and the landing page's product chrome. It replaces the brutalist
language on those surfaces.

## Tokens

| Role | Value |
|---|---|
| Page canvas | `#FAFAFA` |
| Raised surface (cards, topbar, sidebar) | `#FFFFFF` |
| Structural hairline | `#E8E8EC` |
| Row separator | `#F1F1F3` |
| Button border | `#D8D8DE` |
| Text primary | `#131315` |
| Text secondary | `#6E6E73` |
| Text tertiary / column labels | `#A0A0A5` |
| Brand block | `#FF6600` |
| Active-nav tint | `#FFF0E6` bg + `#D14E00` text |
| Accent text (held, active states) | `#D14E00` |
| Danger dot / past due | `#D8434F` |
| Warning dot | `#D39329` |
| Chip bg | `#F1F1F3` |

## Type

- Family: `'Inter Tight', system-ui, sans-serif` everywhere; `'Geist Mono'`
  only for column labels.
- Page title: 22px/28 semibold, tracking -0.02em.
- Card title: 16px/22 semibold. Card subtitle: 14px/20 `#6E6E73`.
- Body/table rows: 14px/20. Secondary cells `#6E6E73`, primary `#131315`.
- Nav rows: 15px/22, semibold when primary/active, medium `#6E6E73` otherwise.
- Section label (sidebar "Projects"): 13px/18 `#A0A0A5`, sentence case.
- Column labels: Geist Mono 11px/14 medium, uppercase, `tracking-widest`,
  `#A0A0A5`.
- Buttons: 13px/18 medium.

## Shape

- Cards: `rounded-[14px]`, 1px `#E8E8EC`, white, `py-5.5 px-6`.
- Inner panels: `rounded-[11px]`, 1px `#E8E8EC`, `#FAFAFA`.
- Active nav row: `rounded-[10px]`, `#FFF0E6`.
- Buttons and chips: full pill (`rounded-full`).
  - Secondary: white, 1px `#D8D8DE`, `py-1.75 px-3.5`.
  - Primary: `#131315` bg, white text, no border.
- Brand block: 32px square, `rounded-[9px]`, `#FF6600`, white bold "S".
- Avatar: 30px circle.

## Chrome

- Topbar: 72px (`h-18`), white, `border-b #E8E8EC`, `px-6`. Left: brand block +
  `snip.` wordmark 22px bold tracking -0.03em. Right: breadcrumb 14px `#6E6E73`
  ("Home / Billing & Invoices") + avatar.
- Sidebar: 232px (`w-58`), white, `border-r #E8E8EC`, `py-6 px-4`. Top group:
  "Projects" label + project rows. Bottom group (pinned): Billing & Invoices,
  Team members, Settings. Active row = tint + `#D14E00`.
- Content: `pt-10 pb-16 px-14`, cards stacked with `gap-3.5`.

## Voice

- No shadows on flat surfaces; hairlines carry the structure.
- No uppercase except Geist Mono column labels.
- 1-3 word labels, no filler subtitles. No emojis. No em dashes.
- Orange is punctuation: brand block, active-nav tint, "Held"/attention text.
  Never large fills.
