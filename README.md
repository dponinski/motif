A new design tool built for design systems first

## What Motif is

A design system builder. It works on the React components and design tokens of a GitHub repository: it reads them, shows them running, lets a designer change them visually and assign tokens to them, documents them, and sends every change back as a pull request. The code in the repository is the source of truth; Motif keeps nothing that the repository doesn't have except documentation and unsent edits. It is not a prototyping tool: there are no shapes, frames or free-form layouts, only the components and tokens of the repository.

## Projects

Each design system is a **project**: one GitHub repository, with its tokens, documentation, imported components and unsent edits. The dashboard lists them. **New project** (or **Connect a repository** on an empty dashboard) takes `owner/name` or a GitHub URL and an access token. Public repositories can be read without one; private ones, and opening pull requests, need a fine-grained token limited to the repository with Contents and Pull requests read and write. The repository is checked before the project is made, so a typo or a missing token shows in the dialog. A token already entered for another project can be reused.

Projects are kept in this browser (local storage), token included, and are saved a moment after every change. Renaming or deleting a project only affects this browser: the repository is not touched, and edits waiting to be sent as a pull request are kept. A new project starts with no tokens and no components: scan the repository (see below) and sync its tokens.

Versions of Motif that were built around design files (`.motif.json` files saved to a branch, with their own sync) are gone, and so are the files, connections and token sets they left in the browser: they are cleared the first time the dashboard opens. Documentation now lives in the project in this browser, not in the repository.

## Signing in with GitHub

Instead of creating and pasting an access token for every repository, a person can **sign in with GitHub**. It uses a **GitHub App** that you create once for your Motif deployment; the app is then installed on the accounts and repositories that should be usable, and each person signs in to approve it.

- **What it gives**: **New project** lists the repositories the app is installed on, to pick from (no `owner/name` to type, nothing to paste), and a project made that way stores no token at all. Scanning, reading a private repository and opening pull requests use the signed-in person's access through the app, and the pull request is opened as them. The app can only reach a repository where it is installed and the person has access. A token typed in for a project is still used for that project, and a public repository can still be added by name with no sign-in. Nothing changes where the server isn't set up for it: the button doesn't appear.
- **Where the tokens are**: the browser is sent to GitHub to approve, GitHub sends it back with a code, and the server exchanges the code for tokens (the exchange needs the app's client secret, which never reaches the browser). The tokens are kept in a cookie the page's scripts can't read (`httpOnly`, `SameSite=Lax`, only sent to `/api/github`, `Secure` on https). The page asks the server for the access token (it lasts 8 hours) and keeps it in memory only; nothing is saved in local storage. The refresh token never leaves the cookie, and renewing needs the client secret too, so it is of no use on its own.
- **Renewing**: a token about to stop working is renewed by the server before it is handed out. If GitHub still refuses a token (revoked, or ended early), the page asks for a new one and repeats the request once, and requests refused together share one renewal. GitHub gives each refresh token one use, so the server also lets two requests that carry the same one (two tabs) share the result for a minute instead of racing. When the refresh token is refused or has run out (after about six months) the person is told the sign-in has ended and signs in again. If GitHub can't be reached the sign-in is kept.
- **Signing out** clears the cookie and revokes the access token at GitHub.
- **A cancelled or refused sign-in** comes back to the page it started from with a message. A sign-in that wasn't started in this browser (the state doesn't match) is not finished. The page to come back to can only be a path on this site.

**Setting it up**

1. Create the app: GitHub, *Settings*, *Developer settings*, *GitHub Apps*, *New GitHub App* (for an organization, under the organization's settings instead). Give it a name and a homepage URL.
2. **Callback URL**: `https://your-domain/api/github/callback`. It must match exactly where the site is served. An app can have several callback URLs (add `http://localhost:3000/api/github/callback` to try it locally, and each deployment you want to sign in from; a preview deployment on another address can't sign in unless its callback is listed).
3. **Expire user authorization tokens**: leave it on (the default). **Request user authorization (OAuth) during installation** can stay off. **Webhook**: untick *Active*; Motif doesn't use one.
4. **Permissions**, under *Repository permissions*: **Contents: Read and write**, **Pull requests: Read and write**. *Metadata: Read-only* is added for you. Nothing else is needed.
5. **Where can this app be installed**: *Only on this account* for your own repositories, *Any account* for others'.
6. Create the app, then **generate a client secret** and note the **Client ID** and the app's **URL name** (the last part of `github.com/apps/<name>`).
7. **Install the app**: *Install App* in the app's settings, on the account or organization that owns the design system repositories, for all or selected repositories.
8. Set these on the server (Hostinger: the Node.js app's environment variables) and redeploy:

| Variable | What |
| --- | --- |
| `GITHUB_APP_CLIENT_ID` | the app's Client ID |
| `GITHUB_APP_CLIENT_SECRET` | the client secret, kept on the server only |
| `GITHUB_APP_SLUG` | the app's URL name, for the link to install it on more repositories |
| `APP_URL` | where the site is served, `https://your-domain`, when it sits behind a proxy that doesn't pass its address on (it has to match the callback URL) |

The server keeps what it needs to share a renewal in memory, so it expects to run as one process. A static export (the desktop build) has no server, so there is no sign-in there and access tokens are used.

## Accounts

Without a database, Motif has no accounts: it is a single-user tool, as before, and everything is kept in the browser. With `DATABASE_URL` set, people can sign in to Motif itself (not just to GitHub for repositories) and the assistant is only for people who have. It needs a PostgreSQL database (the tables are made on first use); Supabase is what it is set up for, see below. Who may sign in is a list you control; there is no sign-up.

| Variable | |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:password@host:5432/database`. Turns accounts on. With Supabase: **Connect → Session pooler** and your database password (see below). |
| `DATABASE_CA` | Optional: the CA certificate (PEM; write its line breaks as `\n`) to check the database server against. Without it the connection is encrypted but the server isn't verified. |
| `ALLOWED_EMAILS` | Who may sign in: addresses and `@domain` entries separated by commas or spaces (`ada@example.com, @acme.io`). **Empty means nobody**: the sign-in dialog says so. A person is matched on an address their provider has *verified*, so the same person signing in with email, Google, Apple and GitHub is one account. The list is checked again on every request, so removing someone ends their sessions. |
| `APP_URL` | Where the site is served (`https://motif.example.com`). Needed behind a proxy and for the callback addresses below. |
| `SMTP_URL`, `MAIL_FROM` | Turns on **email links**: `smtps://user:pass@smtp.example.com:465`. A link works once, for 15 minutes, opens a page that asks for a press (so mail scanners can't use it up), and is only sent to addresses on the list, with the same answer shown for any address. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Turns on **Google**. In the Google Cloud console create an OAuth client of type *Web application* with the redirect URI `APP_URL/api/auth/google/callback`. |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Turns on **Apple** (needs a paid Apple Developer membership and an https site). Create a Services ID (that is the client id) with the return URL `APP_URL/api/auth/apple/callback`, and a *Sign in with Apple* key (the `.p8` file is the private key; write its line breaks as `\n` if it goes in one line). People who hide their email from the app can't be matched to the list; they are told to share it. |
| GitHub | Uses the GitHub App of "Signing in with GitHub". Give the app the account permission **Email addresses: Read-only**; without it nobody can sign in that way, as there is no verified address to go by. |
| `CHAT_PER_HOUR` | How many assistant messages one person may send an hour (default 60, `0` for no limit). |
| `AI_PUBLIC` | Without a database the assistant is open in development and **closed in production** (it spends your Anthropic key); `AI_PUBLIC=true` opens it to anyone who reaches the site. |

How it is kept safe: a session is a random value in an `HttpOnly` cookie of which only a hash is stored; it lasts 30 days from the last visit; sign-in and the assistant refuse requests that don't come from the app itself; links, sign-in attempts and chat messages are rate limited per address and per place; Google and Apple sign-ins use a state, a nonce and (Google) PKCE and check the ID token against the provider's keys; errors are never put in the page beyond a short reason.

### Using Supabase as the database

Create the project, then in **Connect** copy the **Session pooler** connection string (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`) into `DATABASE_URL`. Use the pooler, not the "Direct connection": direct connections are IPv6-only unless you add Supabase's IPv4 add-on, and most hosts (Hostinger included) are IPv4. The transaction pooler (port 6543) works too.

- **The tables are made by the app** the first time it connects (and kept up to date when a new version needs more), so there is nothing to run by hand. They live in the `public` schema with **row level security on and no policies, and no rights for the `anon` and `authenticated` roles**: Supabase's public API (the one the publishable key opens) can't read or write any of them. Only the server, through `DATABASE_URL`, can. Don't add policies or grants to them: the sessions, sign-in links and saved projects are in there.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are only for the Supabase client in `src/utils/supabase`, which nothing uses yet. The database for accounts and projects doesn't need them.
- Keep the database password out of git: it goes in the host's environment variables (or `.env.local`), never in `NEXT_PUBLIC_` ones.

### Projects saved to your account

Signed in, a person's projects are saved to their account and kept the same on every device they use. The browser still works on its own copy, so Motif works offline and edits are never held up by the network; changes are sent a moment after they are made, and other devices are checked every 45 seconds and whenever the window is focused.

- **What is saved**: the project's name, its repository (owner, name, default branch), its tokens, the link to the repository's tokens, and its documentation. **Not** saved: access tokens (they stay in the browser they were typed into, and anything that looks like one is refused by the server), the repository scan and the component library (read again from the repository), and unsent edits to components. On another device a project has no token of its own: sign in with GitHub, or type one.
- **First sign-in**: the projects already in the browser are saved to the account, and the account's projects are brought in. Up to 100 projects per account.
- **Two devices**: each project is compared in five parts (name, repository, token link, tokens, documentation) against what both sides had when they last agreed. A part changed on only one side is taken from that side, so docs edited on one device and tokens on another are combined. Only the *same* part changed differently on both asks a person, once, which version to keep. Nothing is sent for that project until they answer. A project deleted on one device is deleted on the others (unless it was changed here, which asks), and the server keeps a note of the deletion for 90 days.
- **Signing out** takes the account's projects off that browser (after sending anything not yet sent), so the next person to use it doesn't see them; a project that couldn't be sent stays for its owner. A different person signing in on the same browser never receives another account's projects.
- Projects are stored as JSON in the `projects` table, one row per project with a version number that rises with each change; a device that was behind is refused instead of overwriting.

Preview deployments get their own address, so Google, Apple and GitHub sign-in work there only if that address's callback URLs are registered with the provider. Email links work anywhere.

Tests that use a database run when `TEST_DATABASE_URL` points at an empty one (`TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/motif_test npm test`) and are skipped without it.

## Starting from an empty repository

A project doesn't need a repository that already has components or tokens. Connect any repository, empty or not, and Motif **reads it by itself** when the project is first opened (the scan, and the components found in it, which appear in the Components panel). A repository with no components lands on the **build screen**: where to start, with nothing created for you.

- **No commits yet.** A brand-new repository with no commits has nothing to branch from, so no pull request can be opened against it. The build screen (and the token sync dialog) then offers **Create README.md on `main`**: one explicit step that makes the first commit straight to the default branch, a README and nothing else. It is the only change Motif ever makes directly to a branch; everything after goes through a branch and a pull request. It needs sign-in with GitHub, or an access token, that can write to the repository.
- **Tokens, from scratch.** On the Tokens screen, add colors, spacing, radii and shadows as you would anywhere. **Repo sync** sends them to the repository as a pull request that adds a stylesheet of plain CSS variables (`src/styles/tokens.css`, `:root { --primary: #3366ff; }`, with a selector per extra theme). It needs no framework and nothing to import it from: use the file wherever your application loads its styles. The preview applies your tokens as you edit them.
- **Add a framework.** **Add a framework** (Tokens screen, and the build screen) adds a framework to the repository like a dependency, by pull request. **Tailwind CSS v4** is the first: it adds `tailwindcss` to `package.json` (a new one if there is none; an existing one is edited by text, so nothing else in it changes), a stylesheet `src/styles/tailwind.css` with `@import "tailwindcss"` (and an import of the tokens file, when Motif made one), and rewrites Motif's own tokens file so Tailwind reads the tokens as theme values (`@theme`). It refuses when the repository already has Tailwind v3 or v4. After the pull request is merged, **Read the repository again** and Motif edits styles with Tailwind's classes. What it does not do: set up the bundler of your application. It says so in the pull request, which lists what is left to do.

Not here yet: building new components in Motif (the next part), other frameworks, and a single long-lived working branch for all changes.

## Documentation

The Docs view in the editor builds design system documentation from the project. Every token category has a page from the start (swatches, type, spacing, radius and shadow specimens), and so does every imported repository component (see below); add your own pages and blocks for principles, guidelines and do / don't examples. Preview shows the finished site and Export HTML downloads it as a single file. Docs are saved with the project.


**Repository components in the documentation.** Once a repository's components are imported, the documentation has a **Repository components** section with a page for each one: its name, a live preview of every variant (or just the one, for a component without variants), a props table (types, defaults, the options of each variant and the descriptions from the code) and usage code with the import and the variants it can take. The preview is the real component running as it does in the repository, in a sandboxed frame; it is a block like any other, so the designer can add one to any page (**Add block**, then *Component preview*, *props* or *usage*), pick which component it shows, and switch it between one and all variants. The page for a component is named after where it is declared, so everyone who edits it edits the same page.

- **Preview** shows the site as it will be exported, with the live previews running, and **Export HTML** includes them: each preview is a page that carries its own runtime and is told what to show, so the exported file runs anywhere with network access to the package CDN, with no dependency on Motif being online. Without the repository connected the editor says what is missing, and the props and usage are still shown.
- Parts of a compound component (such as `TabsTrigger`) can't be shown without their parent, so their default page's preview shows the component's own error; change or remove that block, or document the parent.
## Reading a repository

Open the Git panel in a project and press Scan to see how its repository is built. No token is needed for public repositories; private ones need a token with Contents read access. Motif parses the code without running it and reports:

- the stack: framework, language, build tool, styling system (Tailwind v3/v4, CSS modules, styled-components, Emotion, plain CSS), variants helper, entry files
- design tokens from CSS custom properties (with `.dark`, `[data-theme]` and `prefers-color-scheme` themes), Tailwind v4 `@theme` blocks, a Tailwind v3 config, and token JSON files
- React components with their props, defaults, doc comments, variants (from `cva` / `tailwind-variants` tables, `keyof typeof` lookups and string unions), hooks, and whether the package entry exports them
- how editable each component will be in the visual editor, and why

Nothing is written to the repository by a scan. Only React repositories are read so far.

**Where to start.** With no repository components imported, the Components panel has a **Repository components** section: **Scan and import components** scans the project's repository (its default branch) and brings the components in, in one step. They then appear in the same panel under **Repository**. A repository with no React components says so, and a private one needs an access token. The Git panel has the same scan with its report, a choice of branch, and a separate Import button.

## Previewing repository components

After a scan, **Import components** (Git panel or the repository view) adds the repository's components to the **Repository** group under Components. Opening one shows it on the canvas, running as the real component from the repository, with its own styles and tokens. With nothing open the centre lists the components, to open one from.

- **The canvas** pans and zooms. Scroll to pan; pinch, or hold Ctrl/Cmd and scroll, to zoom about the pointer; drag the background, or hold Space and drag anywhere, to pan. The buttons at the bottom left zoom, go to 100% and **Fit**, which keeps the component fitted as it loads until you move the view by hand. All of it works with the pointer over the component too: its page passes the wheel and Space up to the canvas, except that a part of the component that scrolls inside itself keeps its own scrolling, and that Space is left to a button or a field that has the focus. The **width** switch (Auto, 375 ... 1280) sets the width of the page the component runs in, so `md:` classes apply as they would in a browser of that width, whatever the zoom.
- **Props**: the right panel has a control for each prop (dropdowns from `cva` variants and string unions, switches for booleans, text) plus the content inside the component. **All variants** shows every combination side by side on the canvas, and the toolbar has Light/Dark and width switches.
- **Examples** show how the repository itself uses a component, taken from its demo, story and example files (`demo/`, `examples/`, `*.stories.tsx`, ...). Each usage becomes an example, and the parts of a compound component (`TabsTrigger`, `CardTitle`) are shown inside their parent. Values that only exist while the demo runs (state, props, local variables) are left out and handlers do nothing; the preview says what was left out. Overlays the demo opened with state are shown open.
- **Motif's tokens**: once tokens are linked to the repository, the tokens you have changed in Motif since the last sync are applied on top of the repository's own styles in every preview, so you see the components in your tokens before a pull request exists. The palette button in the stage toolbar counts them and switches them off.
- **Update from repository** rescans and reports what is new, changed or gone.
- **How it runs**: the code is fetched in the browser, compiled with Sucrase and run in a sandboxed iframe with no access to Motif's storage or GitHub token, a Content Security Policy that blocks network requests and loads only React and the repository's packages from esm.sh and Tailwind's browser build from jsDelivr. Previews need network access to those CDNs, and image requests to https hosts are allowed.
- **Not supported yet** (the stage says so): CSS modules, Tailwind v3, Sass and `next/*` imports. Compound parts such as `TabsTrigger` render on their own only through their examples.
- Nothing is written to the repository.

## Editing repository components

Open a repository component and press **Edit** in the stage toolbar. Click any element in the preview to select it, or pick it in the **Layers** panel on the left: a tree of what the component renders, read from its source, which opens down to the selected element and follows every change (components used inside it are shown but can't be picked; open them to edit them). The right panel shows what can be changed, and every change is made to the component's real source and shown in the preview straight away.

- **Layout, spacing, size, type, fill and border** are controls over the element's Tailwind classes: display, direction, gap, alignment, padding, margin, width, height, text size and weight, color, background, border, radius and shadow. A change replaces the class where it already is, so the diff is the one class that changed. Classes with a modifier (`hover:`, `md:`, `dark:`) are left as written.
- **Tokens**: the controls offer the repository's own design tokens, the ones it exposes to Tailwind (`--color-primary`, `--radius-md`, `--shadow-card`, `--text-*`, `--font-*`, named `--spacing-*` in `@theme`, or the same sections of a Tailwind 3 config), read by the last scan.
  - A **color** is a picker: the repository's color tokens with a swatch of each in the theme that is showing, a search box, the words `transparent`, `current`, `white` and `black`, and an opacity. Choosing a color keeps the opacity the class has (`hover:bg-primary/90` becomes `hover:bg-danger/90`); typing `name/50` sets both. A color typed or pasted as a value (`#4f46e5`, `oklch(...)`) finds the token that is that color; anything else that is typed is written as it is, so a Tailwind color such as `red-500` can still be used.
  - **Radius, shadow, text size, font and spacing** are lists with the repository's tokens first, each with what it is worth (`md · 8px`), then what Tailwind ships with and the repository has not replaced. Steps of the spacing scale say how big they are (`4 · 16px`), from the repository's own `--spacing` when it sets one.
  - A dot beside a label says the value is one of the repository's tokens. A value that is **written out** (`bg-[#4f46e5]`, `rounded-[8px]`, `p-[18px]`), or a Tailwind palette color in a repository that has color tokens, is marked as not a token, with a count for the element, and offered the token or step that is the same (**Use primary**, **Use md (8px)**, **Use 4.5 (18px)**) or, failing that, the closest, said to be only that. One press replaces it; an exact one leaves the component looking the same.
  - With the names known, `text-display` is read as a size when the repository has a `--text-display` and as a color otherwise, and `shadow-card` as a shadow where `shadow-primary` is the color of one.
  - Tokens the repository defines only as CSS variables, without a Tailwind name, are not offered, because no class names them. Colors are compared in the base theme. Token swatches follow the stage's theme and, when Motif's unsent token changes are shown in previews, those values.
- **Classes are found** in a plain `className`, in `cn(...)` / `clsx(...)` strings, and in `cva` / `tailwind-variants` tables: the base and the variant that is showing are edited, and a string written as `"a " + "b"` keeps its shape. Classes built at runtime or defined in another file are shown as such and not edited.
- **States and breakpoints**: the **State** selector in the inspector switches the controls between the plain classes and the ones for hover, focus, active, disabled, dark mode and the `sm`/`md`/`lg`/`xl` breakpoints. A state's value is written as its own class (`hover:bg-muted`, `md:gap-6`) next to the plain class it belongs to, in the same string, and the plain class is never touched; a property only the plain class sets is shown as inherited. Choosing dark turns the dark theme on and choosing a breakpoint sets the preview to that width; hover shows when the pointer is over the element. Focus and active can't be forced in a browser, so their classes are edited but not shown.
- **Text, order and structure**: edit an element's text, move it up or down among its siblings, duplicate it or delete it. The root of a component can't be deleted.
- **Insert, wrap and change**: the Structure section adds an element inside (first or last), before or after the selected one, from a small set of HTML snippets (div, text, heading, paragraph, button, link, list) or from the repository's own components, which are written with their usual starting props and the import they need, in the file's own style (reusing an existing import of the same module, refusing a name the file already uses). **Wrap in** puts the element inside a new div, row, column, section or component, **Unwrap** takes a wrapper with one element in it off, and **Tag** changes `div` to `section`, `h2` to `h3` and so on without losing classes or content. A new element is selected straight away. Elements can only be added beside another element inside a parent element, and never inside `img`, `input` and other elements that can't hold children.
- **Props and variants**: in Edit mode the right panel has a **Props and variants** section. For each `cva` variant group it lists the options: add one (it starts with the classes of the default option, so it looks the same until you change it, and then it is edited like any other option), rename one, remove one, and choose which is the default. **New variant group** adds a group to a `cva` call and wires it in: the cva call passes it and the component takes it from its props. For plain props it adds a prop (to the props interface or type and to the destructured parameters, with an optional default), changes or removes a default, and removes a prop that nothing in the component uses. The controls, All variants and defaults shown for the component follow these edits straight away. Renaming an option that is also used somewhere else in the file, removing the default or the only option, and removing a prop that is still used are refused with the reason, and so are shapes it can't place safely (props that aren't destructured, `cva` called without an object, variants that come from a type or a lookup table rather than `cva`).
- **Undo and redo** step through every change, and **Create pull request** (toolbar) shows the diff of each file, then opens a branch and a pull request from the branch that was imported. Nothing is written to a branch directly, and a file that changed in the repository in the meantime stops the pull request instead of being overwritten.
- **Edits are kept** in this browser, for the repository and branch they were made on, so a reload (or closing the tab) doesn't lose them: the changes, their undo history (the last 60 steps) and the original text of each changed file. Updating from the repository keeps them too. If the repository has changed a file you edited since, the stage says so and offers to give up the edits to those files, because a pull request couldn't be made for them as they are. Because the original text of the files is kept, for a private repository this includes its code, which stays in this browser like the access token does. Once edits are sent as a pull request they are gone. After it is merged, press Update from repository.

## The assistant

**Chat** (the sparkle in the rail, or Ctrl/Cmd+K) is an assistant for the design system. It needs `ANTHROPIC_API_KEY` set on the server; without it the chat says so. Where [accounts](#accounts) are set up, it is for people who are signed in, and limited per person. Each question is sent with what the assistant needs to answer about this project, and nothing else: the open component (its props and variants, and its elements with their classes and text), and the repository's tokens with what each is worth in the theme that is showing. It does not receive the repository's source files, the access token or where the code is kept. Anything in that context comes from the repository and is marked to the model as data, not instructions.

It can answer in words (review a component for accessibility or consistency, naming, advice) and it can **suggest**, as a card under its reply that you choose to apply or dismiss:

- **Changes to the open component**: a class group on an element (`text-size`, `bg`, `gap` ... in any state the inspector offers) or an element's text, named by the element's place in the component. They are checked before anything is shown: an element that isn't there, another component, a group or state the inspector doesn't have, a value with characters that could end a class, or one that isn't in a fixed list (`display: banana`) is left out, with the reason. Each change is shown as what it changes, from what the component has (`<h2> Text size lg → 2xl`), with values that are not tokens marked. **Apply** makes them with the same engine as the inspector, as **one step** to undo (Ctrl/Cmd+Z or the Undo button, in Edit mode or not), and they go out in the pull request like any other edit. If the component's elements have changed since the question, the suggestion is refused and you are asked to ask again.
- **New tokens**: colors (with an optional dark value), spacing, radius and shadows, added to Motif's token set, from where **Sync tokens** sends them to the repository as a pull request. A name the set already has is left as it is. Typography and fonts can't be sent to a repository yet, so they are not taken.

It cannot add, remove or move elements, change props or variants, or edit anything the inspector can't. The chat starts again when another project is opened.

## Syncing tokens with a repository

Open **Sync tokens** in the Git panel (or **Repo sync** in the Tokens view) with a repository connected. Opening pull requests needs a token with Contents and Pull requests read and write.

- **The repository has tokens**: import them into a new Motif set, one theme per repository theme. Colors (in `oklch`, `hsl`, `rgb` or hex), radius, spacing and shadows are synced; fonts and other tokens are listed as left out.
- **Later syncs**: *Check* compares Motif and the repository against the last sync. Changes from the repository are applied to Motif; changes made in Motif go back as a pull request that edits the stylesheet in place, in the notation it already uses, so the diff is only the values you changed. New tokens are added following the repository's own conventions (variables per theme, the Tailwind alias, `@theme`).
- **Conflicts**: when both sides changed the same value you choose which to keep.
- **The repository has no tokens**: send a Motif set as a pull request that adds a `tokens.css` of CSS variables (wired into Tailwind v4 and imported from its stylesheet when there is one).
- **Syncing never deletes a token from a repository.** A token deleted in Motif comes back on the next sync, and one removed in the repository is removed from Motif.
- Tokens defined in a Tailwind v3 config or a token JSON file are read, but writing changes back to them is not supported yet.

```bash
npm test
```

## Building on a server with an old glibc

`npm run build` uses Webpack (`next build --webpack`). Next 16 builds with Turbopack by default, which needs Next's native compiler, and that needs glibc 2.29 or newer; on an older host (some shared hosting) Next falls back to its WebAssembly compiler, which only Webpack supports. Webpack builds the same app everywhere, so the build doesn't depend on the host. `npm run dev` still uses Turbopack.
