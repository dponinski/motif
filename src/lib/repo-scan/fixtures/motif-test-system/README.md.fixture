# Motif

A basic React design system styled with Tailwind CSS v4.

```bash
npm install
npm run dev      # component showcase at http://localhost:5173
npm run build    # typecheck + production build
```

## Structure

```
src/
  styles/motif.css   design tokens (colors, radii, shadows, fonts) + light/dark themes
  lib/cn.ts          className merge helper (clsx + tailwind-merge)
  components/        the components
  index.ts           public exports
demo/                showcase page used by `npm run dev`
```

## Tokens

Semantic colors are CSS variables in `src/styles/motif.css`, exposed to Tailwind via `@theme inline`,
so you write `bg-primary`, `text-muted-foreground`, `border-border` and so on. Dark mode swaps the
variables when an ancestor has the `.dark` class. To retheme, edit the variables, not the components.

| Token | Use |
| --- | --- |
| `background` / `foreground` | page background and default text |
| `surface` | cards, modals |
| `muted` / `muted-foreground` | subtle fills, secondary text |
| `border`, `ring` | borders, focus rings |
| `primary`, `secondary` | brand actions |
| `success`, `warning`, `danger` | status |

Each color has a matching `-foreground` for text placed on it.

## Components

| Component | Notes |
| --- | --- |
| `Button` | `variant`: primary, secondary, outline, ghost, danger · `size`: sm, md, lg, icon · `loading` |
| `Input`, `Textarea`, `Select` | `invalid` sets error styling and `aria-invalid` |
| `Field` | wraps a control with label, hint and error, and wires up `id` / `aria-describedby` |
| `Checkbox`, `Switch` | `Switch` is controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`) |
| `Card` (+ `Header`, `Title`, `Description`, `Content`, `Footer`) | composable container |
| `Badge` | neutral, primary, success, warning, danger, outline |
| `Alert` | info, success, warning, danger, with an optional `title` |
| `Avatar` | image with an initials fallback |
| `Tabs` (+ `List`, `Trigger`, `Content`) | arrow-key navigation, ARIA tabs pattern |
| `Modal` | native `<dialog>`: focus trap, Escape and backdrop click to close |

```tsx
import "./styles/motif.css";
import { Button, Field, Input } from "./index";

<Field label="Email" error={error} required>
  <Input type="email" />
</Field>
<Button variant="primary" loading={saving}>Save</Button>
```

Every component accepts `className`, and conflicting Tailwind classes you pass override the defaults.
