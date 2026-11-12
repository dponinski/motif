"use client";

import { useEffect, useRef, useState } from "react";
import { repoSlug, useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import type { DocBlock } from "@/lib/motif-document";
import { useGitHost } from "@/components/git/hooks";
import { usePreviewPage } from "@/components/stage/docs-previews";

type Block = Extract<DocBlock, { type: "repo-preview" }>;

// A repository component in a documentation page, running as it does in the repository: the same page that an
// exported site carries, in a sandboxed frame that tells the page how tall it is.
export default function RepoDocPreview({ block }: { block: Block }) {
  const source = useLibraryStore((s) => s.source);
  const component = useLibraryStore((s) => s.components.find((c) => c.file === block.ref.file && c.name === block.ref.name));
  const connection = useGitStore((s) => s.connection);
  const connected = !!connection && !!source && repoSlug(connection) === source.repo;

  if (!component) return <p className="md-empty">{block.ref.name} isn&apos;t among the imported repository components.</p>;
  if (!connected) return <p className="md-empty">Connect {source?.repo ?? "the repository"} in the Git panel to show {component.name} here.</p>;
  return <Live component={component} view={block.view} source={source} connection={connection} />;
}

function Live({ component, view, source, connection }: { component: NonNullable<ReturnType<typeof useLibraryStore.getState>["components"][number]>; view: Block["view"]; source: NonNullable<ReturnType<typeof useLibraryStore.getState>["source"]>; connection: NonNullable<ReturnType<typeof useGitStore.getState>["connection"]> }) {
  const host = useGitHost(connection);
  const { page, error } = usePreviewPage(component, view, source, host);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; height?: number } | null;
      if (event.source === frame.current?.contentWindow && data?.type === "rendered" && typeof data.height === "number") setHeight(Math.max(40, data.height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (error) return <p className="md-empty" style={{ color: "#b91c1c" }}>{component.name} can&apos;t be shown: {error}</p>;
  if (!page) return <p className="md-empty">Loading {component.name}…</p>;
  return (
    <div className="md-preview md-live">
      <iframe
        ref={frame}
        data-md-live
        title={`${component.name} preview`}
        // Opaque origin: no access to Motif's storage, tokens or cookies.
        sandbox="allow-scripts"
        srcDoc={page}
        style={{ height }}
      />
    </div>
  );
}
