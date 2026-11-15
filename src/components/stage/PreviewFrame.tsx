"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderItem, ToPreview } from "@/lib/preview/protocol";
import { isFromPreview } from "@/lib/preview/protocol";
import { FrameLabel, WidthHandle } from "./Frame";

// One preview of the component: a page of its own (an iframe) at a width, with its label above. The stage shows one, or several side
// by side at different widths; each is the same component from the same source, so an edit made in one shows in all of them.
export interface PreviewFrameProps {
  // Told to the stage's messages as "which frame", and what its handlers look the frame up by.
  id: string;
  name: string;
  srcdoc: string;
  width: number;
  // A width that was chosen (a breakpoint, or dragged to) is the page's own width inside its border, so a `md:` class applies at 768.
  chosen: boolean;
  dark: boolean;
  items: RenderItem[];
  layout: "single" | "grid" | "stack";
  overrides: string;
  theme: string;
  editing: boolean;
  selectedKey: string | null;
  file: string;
  revision: number;
  zoom: number;
  // The edits this page has missed: it was loaded from the source as it was before them.
  catchUp: () => ToPreview[];
  register: (id: string, element: HTMLIFrameElement | null) => void;
  onReady: () => void;
  onRendered: () => void;
  // Only the frame whose width can be dragged has these.
  onResize?: (width: number) => void;
  onResizing?: (on: boolean) => void;
}

export default function PreviewFrame(p: PreviewFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(120);
  const renderId = useRef(0);

  useEffect(() => { setReady(false); }, [p.srcdoc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow || !isFromPreview(event.data)) return;
      if (event.data.type === "ready") {
        // What the page has missed goes first, so that it renders the source as it is now.
        const post = (m: ToPreview) => ref.current?.contentWindow?.postMessage(m, "*");
        for (const m of p.catchUp()) post(m);
        setReady(true);
        p.onReady();
      } else if (event.data.type === "rendered") {
        setHeight(event.data.height);
        p.onRendered();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.srcdoc]);

  const post = (message: ToPreview) => ref.current?.contentWindow?.postMessage(message, "*");
  useEffect(() => {
    if (ready) post({ type: "render", id: ++renderId.current, items: p.items, layout: p.layout, dark: p.dark, overrides: p.overrides, theme: p.theme });
     
  }, [ready, p.items, p.layout, p.dark, p.overrides, p.theme]);
  useEffect(() => { if (ready) post({ type: "zoom", zoom: p.zoom });   }, [ready, p.zoom]);
  // The preview is on a canvas: scrolling, pinching and Space over it move the canvas, not the page inside.
  useEffect(() => { if (ready) post({ type: "canvas", on: true });   }, [ready]);
  // Which element is selected, and whether clicking picks one.
  useEffect(() => {
    if (ready) post({ type: "edit", on: p.editing, selected: p.selectedKey, file: p.file });
     
  }, [ready, p.editing, p.selectedKey, p.revision, p.file]);

  useEffect(() => {
    const el = ref.current;
    p.register(p.id, el);
    return () => p.register(p.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const h = Math.max(height, 80);
  return (
    <div data-frame data-frame-id={p.id} className="flex flex-col gap-1.5">
      <FrameLabel name={p.name} width={p.width} height={h} dark={p.dark} />
      <div className="relative">
        <iframe
          ref={ref}
          title="Component preview"
          data-frame-width={p.width}
          // Opaque origin: no access to Motif's storage, tokens or cookies.
          sandbox="allow-scripts"
          srcDoc={p.srcdoc}
          // Content-box, so a 768 preview is 768 wide inside its border and a `md:` class applies.
          style={{ display: "block", width: p.width, height: h, boxSizing: p.chosen ? "content-box" : "border-box", backgroundColor: p.dark ? "#0b0b0f" : "#ffffff" }}
          className="rounded-lg border border-surface-border shadow-sm"
        />
        {p.onResize && p.onResizing && <WidthHandle start={() => p.width} onResize={p.onResize} onResizing={p.onResizing} />}
      </div>
    </div>
  );
}
