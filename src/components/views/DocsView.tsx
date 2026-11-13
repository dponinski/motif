"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, BookOpen, Download, Plus, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { cn, downloadString } from "@/lib/utils";
import {
  BLOCK_TYPES, TOKEN_KINDS, createBlock, docSections, isBuiltInPage, pageRepoRef, previewKey, repoKey,
  type BlockType, type DocSection,
} from "@/lib/docs";
import { DOCS_CSS, blockHtml, renderDocsSite, type DocsContext } from "@/lib/docs-html";
import type { DocBlock, DocPage, RepoRef, TokenKind } from "@/lib/motif-document";
import { repoSlug, useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { clientFor } from "@/components/git/hooks";
import { buildPreviews } from "@/components/stage/docs-previews";
import RepoDocPreview from "./RepoDocPreview";
import { useDesignSystemStore } from "@/store/design-system";
import { useDocsStore } from "@/store/docs";
import { useProjectsStore } from "@/store/projects";

// The connected repository's components, for pages that document them. Empty until some are imported.
function useRepoComponents() {
  return useLibraryStore((s) => s.components);
}

function useDocsContext(): DocsContext {
  const repo = useRepoComponents();
  const { colors, typography, spacing, radii, shadows } = useDesignSystemStore();

  return useMemo(
    () => ({
      tokens: { colors, typography, spacing, radii, shadows },
      repo: repo.length ? { components: repo } : undefined,
    }),
    [colors, typography, spacing, radii, shadows, repo]
  );
}

// ── Editing primitives ────────────────────────────────────────────────────────

function AutoTextarea({
  value, onChange, placeholder, label,
}: {
  value: string; onChange: (value: string) => void; placeholder: string; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none [color:inherit] [font:inherit] [letter-spacing:inherit] placeholder:text-neutral-400"
    />
  );
}

function ToolButton({ title, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      title={title}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  );
}

function AddBlockMenu({ onAdd, children }: { onAdd: (type: BlockType) => void; children: React.ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{children}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[170px] rounded-lg border border-surface-border bg-surface-overlay p-1 shadow-lg"
        >
          {BLOCK_TYPES.map(({ type, label }) => (
            <Menu.Item
              key={type}
              onSelect={() => onAdd(type)}
              className="cursor-pointer rounded px-2 py-1.5 text-xs text-text-secondary outline-none data-[highlighted]:bg-surface-subtle data-[highlighted]:text-text-primary"
            >
              {label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const pickerClass = "h-6 max-w-[140px] rounded border border-neutral-200 bg-white px-1 text-[11px] text-neutral-700 outline-none";

// ── Blocks ────────────────────────────────────────────────────────────────────

function BlockBody({ block, ctx, onChange }: { block: DocBlock; ctx: DocsContext; onChange: (patch: Partial<DocBlock>) => void }) {
  switch (block.type) {
    case "heading":
      return <h2><AutoTextarea value={block.text} onChange={(text) => onChange({ text })} placeholder="Heading" label="Heading" /></h2>;
    case "text":
      return <p><AutoTextarea value={block.text} onChange={(text) => onChange({ text })} placeholder="Write something…" label="Text" /></p>;
    case "guideline":
      return (
        <div className="md-guideline">
          <div className="md-do">
            <strong>Do</strong>
            <AutoTextarea value={block.do} onChange={(text) => onChange({ do: text })} placeholder="What to do…" label="Do" />
          </div>
          <div className="md-dont">
            <strong>Don&apos;t</strong>
            <AutoTextarea value={block.dont} onChange={(text) => onChange({ dont: text })} placeholder="What to avoid…" label="Don't" />
          </div>
        </div>
      );
    case "repo-preview":
      return <RepoDocPreview block={block} />;
    default:
      // blockHtml escapes everything it takes from the document.
      return <div dangerouslySetInnerHTML={{ __html: blockHtml(block, ctx) }} />;
  }
}

function BlockPicker({ block, ctx, onChange }: { block: DocBlock; ctx: DocsContext; onChange: (patch: Partial<DocBlock>) => void }) {
  if (block.type === "tokens") {
    return (
      <select className={pickerClass} aria-label="Token type" value={block.kind} onChange={(e) => onChange({ kind: e.target.value as TokenKind })}>
        {TOKEN_KINDS.map(({ kind, title }) => <option key={kind} value={kind}>{title}</option>)}
      </select>
    );
  }
  if (block.type === "repo-preview" || block.type === "repo-props" || block.type === "repo-code") {
    const components = ctx.repo?.components ?? [];
    const key = repoKey(block.ref);
    return (
      <>
        <select
          className={pickerClass}
          aria-label="Repository component"
          value={components.some((c) => repoKey(c) === key) ? key : ""}
          onChange={(e) => { const c = components.find((x) => repoKey(x) === e.target.value); if (c) onChange({ ref: { file: c.file, name: c.name } }); }}
        >
          {!components.some((c) => repoKey(c) === key) && <option value="">{block.ref.name || "Choose…"}</option>}
          {components.map((c) => <option key={repoKey(c)} value={repoKey(c)}>{c.name}</option>)}
        </select>
        {block.type === "repo-preview" && (
          <select className={pickerClass} aria-label="Preview shows" value={block.view} onChange={(e) => onChange({ view: e.target.value as "single" | "variants" })}>
            <option value="single">One</option>
            <option value="variants">All variants</option>
          </select>
        )}
      </>
    );
  }
  return null;
}

// ── Page editor ───────────────────────────────────────────────────────────────

function PageEditor({ page, ctx }: { page: DocPage; ctx: DocsContext }) {
  const savePage = useDocsStore((s) => s.savePage);
  const first = ctx.repo?.components[0];
  const defaultRef: RepoRef = pageRepoRef(page.id) ?? (first ? { file: first.file, name: first.name } : { file: "", name: "" });

  const setBlocks = (blocks: DocBlock[]) => savePage({ ...page, blocks });
  const update = (id: string, patch: Partial<DocBlock>) =>
    setBlocks(page.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as DocBlock) : b)));
  const insert = (type: BlockType, after: number) => {
    const blocks = [...page.blocks];
    blocks.splice(after + 1, 0, createBlock(type, nanoid(6), defaultRef));
    setBlocks(blocks);
  };
  const move = (index: number, delta: -1 | 1) => {
    const blocks = [...page.blocks];
    [blocks[index], blocks[index + delta]] = [blocks[index + delta], blocks[index]];
    setBlocks(blocks);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-surface-base px-6">
      <div className="motif-docs mx-auto my-8 w-full max-w-[820px] select-text rounded-xl border border-surface-border bg-white px-14 py-12 shadow-sm">
        <h1>
          {isBuiltInPage(page.id)
            ? page.title
            : <AutoTextarea value={page.title} onChange={(title) => savePage({ ...page, title })} placeholder="Untitled" label="Page title" />}
        </h1>

        {page.blocks.map((block, i) => (
          <div
            key={block.id}
            className="md-block group/block relative rounded hover:outline-dashed hover:outline-1 hover:outline-offset-[6px] hover:outline-neutral-300"
          >
            <div className="absolute -top-4 right-0 z-10 hidden items-center gap-0.5 rounded-md border border-neutral-200 bg-white px-1 py-0.5 shadow-sm group-focus-within/block:flex group-hover/block:flex has-[[data-state=open]]:flex">
              <BlockPicker block={block} ctx={ctx} onChange={(patch) => update(block.id, patch)} />
              <ToolButton title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></ToolButton>
              <ToolButton title="Move down" disabled={i === page.blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></ToolButton>
              <AddBlockMenu onAdd={(type) => insert(type, i)}>
                <ToolButton title="Add block below"><Plus size={12} /></ToolButton>
              </AddBlockMenu>
              <ToolButton title="Delete block" onClick={() => setBlocks(page.blocks.filter((b) => b.id !== block.id))}><Trash2 size={12} /></ToolButton>
            </div>
            <BlockBody block={block} ctx={ctx} onChange={(patch) => update(block.id, patch)} />
          </div>
        ))}

        <AddBlockMenu onAdd={(type) => insert(type, page.blocks.length - 1)}>
          <button className="flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800">
            <Plus size={12} /> Add block
          </button>
        </AddBlockMenu>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  sections, selectedId, onSelect, onAddPage,
}: {
  sections: DocSection[]; selectedId: string; onSelect: (id: string) => void; onAddPage: () => void;
}) {
  const { deletePage, movePage } = useDocsStore.getState();

  return (
    <div className="w-[220px] flex-shrink-0 overflow-y-auto border-r border-surface-border bg-surface-raised pb-3">
      {sections.map((section, sectionIndex) => (
        <div key={section.title}>
          <div className="flex items-center px-3 pb-1 pt-3">
            <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">{section.title}</span>
            {sectionIndex === 0 && (
              <button onClick={onAddPage} title="New page" className="rounded p-0.5 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary">
                <Plus size={11} />
              </button>
            )}
          </div>
          {section.pages.length === 0 && (
            <p className="px-3 pb-1 text-2xs leading-relaxed text-text-tertiary">
              Add pages for principles, guidelines or anything else.
            </p>
          )}
          {section.pages.map((page, i) => (
            <div
              key={page.id}
              className={cn(
                "group mx-1 flex items-center rounded transition-colors",
                page.id === selectedId ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
              )}
            >
              <button className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs" onClick={() => onSelect(page.id)}>
                {page.title || "Untitled"}
              </button>
              {sectionIndex === 0 && (
                <span className="hidden flex-shrink-0 items-center pr-1 group-hover:flex">
                  <button title="Move up" disabled={i === 0} onClick={() => movePage(page.id, -1)} className="rounded p-0.5 hover:bg-surface-overlay disabled:opacity-30"><ArrowUp size={10} /></button>
                  <button title="Move down" disabled={i === section.pages.length - 1} onClick={() => movePage(page.id, 1)} className="rounded p-0.5 hover:bg-surface-overlay disabled:opacity-30"><ArrowDown size={10} /></button>
                  <button title="Delete page" onClick={() => deletePage(page.id)} className="rounded p-0.5 hover:bg-surface-overlay hover:text-red-400"><Trash2 size={10} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function DocsView({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const fileName = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.name) ?? "Design system";
  const pages = useDocsStore((s) => s.pages);
  const ctx = useDocsContext();
  const repo = useRepoComponents();
  const sections = useMemo(
    () => docSections(pages, repo.map((c) => ({ file: c.file, name: c.name, hasVariants: c.variants.length > 0 }))),
    [pages, repo]
  );

  // Live previews of repository components are pages of their own, built when they are needed: to look at the
  // documentation as it will be exported, and to export it.
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);
  const host = useMemo(
    () => (connection ? clientFor(connection) : null),
    [connection]
  );
  const connected = !!connection && !!source && repoSlug(connection) === source.repo;
  const wanted = useMemo(() => {
    const out: { component: (typeof repo)[number]; view: "single" | "variants" }[] = [];
    for (const block of sections.flatMap((s) => s.pages).flatMap((p) => p.blocks)) {
      if (block.type !== "repo-preview") continue;
      const component = repo.find((c) => c.file === block.ref.file && c.name === block.ref.name);
      if (component) out.push({ component, view: block.view });
    }
    return out;
  }, [sections, repo]);
  const wantedKey = wanted.map((w) => previewKey(w.component, w.view)).sort().join("\n");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const prepare = async (): Promise<Record<string, string>> => {
    if (!connected || !source || !host || wanted.length === 0) return {};
    setPreparing(true);
    try {
      const out = await buildPreviews(wanted, source, host);
      setPreviews(out);
      return out;
    } finally {
      setPreparing(false);
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    if (mode === "preview") void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, wantedKey, connected]);

  const all = sections.flatMap((s) => s.pages);
  const page = all.find((p) => p.id === selectedId) ?? all[0];

  const addPage = () => {
    const id = nanoid(8);
    useDocsStore.getState().savePage({ id, title: "Untitled page", blocks: [{ id: nanoid(6), type: "text", text: "" }] });
    setSelectedId(id);
    setMode("edit");
  };

  const withPreviews = (live: Record<string, string>): DocsContext => ({ ...ctx, repo: ctx.repo ? { ...ctx.repo, previews: live } : undefined });

  const exportSite = async () => {
    const slug = fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design-system";
    const live = await prepare();
    downloadString(renderDocsSite(fileName, sections, withPreviews(live)), `${slug}-docs.html`, "text/html");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface-base">
      <style>{DOCS_CSS}</style>

      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-surface-border bg-surface-raised px-4">
        <BookOpen size={14} className="flex-shrink-0 text-accent" />
        <span className="flex-1 text-sm font-semibold text-text-primary">Documentation</span>

        <div className="flex items-center gap-0.5 rounded bg-surface-subtle p-0.5">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                mode === m ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button onClick={exportSite} disabled={preparing} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-60">
          <Download size={11} /> {preparing ? "Preparing previews…" : "Export HTML"}
        </button>

        <div className="h-5 w-px bg-surface-border" />
        <button onClick={onClose} className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary" title="Back to the editor">
          <X size={14} />
        </button>
      </div>

      {mode === "preview" ? (
        <div className="relative flex flex-1 flex-col">
          <iframe
            title="Documentation preview"
            // Scripts only run for the live previews, which are frames of their own with the same restriction.
            sandbox={Object.keys(previews).length ? "allow-scripts" : ""}
            // Without this base, "#page" links resolve against the app's URL and load the app inside the frame.
            srcDoc={renderDocsSite(fileName, sections, withPreviews(previews)).replace("<head>", '<head><base href="about:srcdoc">')}
            className="w-full flex-1 bg-white"
          />
          {preparing && <p role="status" className="pointer-events-none absolute right-4 top-3 rounded bg-surface-raised px-2 py-1 text-xs text-text-secondary shadow">Preparing live previews…</p>}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar sections={sections} selectedId={page.id} onSelect={setSelectedId} onAddPage={addPage} />
          <PageEditor key={page.id} page={page} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
