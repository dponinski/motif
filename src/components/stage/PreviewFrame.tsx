"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { initialProps } from "@/lib/preview/props";
import { isFromPreview, type RenderMessage } from "@/lib/preview/protocol";
import type { LibraryComponent } from "@/lib/preview/library";
import type { GitConnection } from "@/store/git";
import type { LibrarySource } from "@/store/library";
import { useGitHost } from "@/components/git/hooks";
import { componentGraph, useSrcdoc } from "./preview-core";
import { readerFor } from "./reader";

// A repository component running in its own sandboxed page, with nothing around it, for use inside a design.
// It reports how big the component is; what to do with that is up to whoever placed it.
export default function PreviewFrame({
  component, source, connection, props, fit, width, dark, overrides, onSize,
}: {
  component: LibraryComponent;
  source: LibrarySource;
  connection: GitConnection;
  props: Record<string, unknown>;
  // Take the component's own size (a button is as wide as its text) instead of filling `width`.
  fit: boolean;
  width: number;
  dark: boolean;
  overrides: string;
  onSize?: (width: number, height: number) => void;
}) {
  const host = useGitHost(connection);
  const reader = useMemo(() => readerFor(source, host), [source, host]);
  const doc = useSrcdoc(true, component.file, source, host, componentGraph(host, reader, source, component.file));

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const renderId = useRef(0);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const sizeRef = useRef(onSize);
  sizeRef.current = onSize;

  useEffect(() => { setReady(false); setFailure(null); }, [doc.srcdoc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isFromPreview(event.data)) return;
      const data = event.data;
      if (data.type === "ready") setReady(true);
      else if (data.type === "rendered") { setHeight(data.height); sizeRef.current?.(data.width ?? width, data.height); }
      else if (data.type === "error") setFailure(data.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [width]);

  const merged = useMemo(() => ({ ...initialProps(component), ...props }), [component, props]);
  const exportName = component.exported === "default" ? "default" : component.name;
  useEffect(() => {
    if (!ready) return;
    const message: RenderMessage = { type: "render", id: ++renderId.current, items: [{ key: "main", path: component.file, exportName, props: merged }], layout: "bare", fit, dark, overrides };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [ready, component.file, exportName, merged, fit, dark, overrides]);

  const note = doc.unsupported.length ? doc.unsupported[0] : doc.error ?? failure;
  if (note) {
    return <div style={{ font: "11px/1.4 ui-monospace, monospace", color: "#b91c1c", padding: 8, whiteSpace: "pre-wrap" }}>{note}</div>;
  }
  if (!doc.srcdoc) return <div style={{ font: "11px ui-monospace, monospace", color: "#71717a", padding: 8 }}>Loading {component.name}…</div>;
  return (
    <iframe
      ref={iframeRef}
      title={`${component.name} preview`}
      // Opaque origin: no access to Motif's storage, tokens or cookies.
      sandbox="allow-scripts"
      srcDoc={doc.srcdoc}
      // A component that fits its content is laid out in a wide page so it isn't wrapped before it is measured.
      style={{ border: 0, display: "block", background: "transparent", colorScheme: dark ? "dark" : "light", width: fit ? 1600 : width, height: Math.max(height, 1) }}
    />
  );
}
