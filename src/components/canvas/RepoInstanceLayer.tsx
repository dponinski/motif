"use client";

import { useEffect, useMemo, useRef } from "react";
import { absPos, matrixCss } from "@/lib/canvas-geometry";
import { initialProps } from "@/lib/preview/props";
import { repoSlug, useGitStore } from "@/store/git";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";
import { useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import PreviewFrame from "@/components/stage/PreviewFrame";
import { useTokenOverrides } from "@/components/stage/preview-core";

// More than this many live pages on one canvas is slow, so the rest show where they are and what they are.
export const MAX_LIVE_INSTANCES = 12;

// The repository components placed on the canvas, drawn as the real thing. They are plain DOM above the canvas,
// moved and scaled with the same transform as the canvas so they stay where the canvas says; the canvas keeps
// selecting, moving and resizing them through a box of the same size underneath.
export default function RepoInstanceLayer({ canvas }: { canvas: { viewportTransform: number[]; on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void } | null }) {
  const elements = useCanvasStore((s) => s.elements);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const setMeasuredSize = useCanvasStore((s) => s.setMeasuredSize);
  const source = useLibraryStore((s) => s.source);
  const library = useLibraryStore((s) => s.components);
  const connection = useGitStore((s) => s.connection);
  const dark = usePreviewStore((s) => s.dark);
  const overrides = useTokenOverrides(source?.repo ?? null).shown;
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvas) return;
    const apply = () => {
      const el = inner.current;
      if (!el) return;
      el.style.transform = matrixCss(canvas.viewportTransform);
      el.style.setProperty("--zoom", String(canvas.viewportTransform[0] ?? 1));
    };
    apply();
    canvas.on("after:render", apply);
    return () => canvas.off("after:render", apply);
  }, [canvas]);

  const instances = useMemo(() => Object.values(elements).filter((e) => e.type === "instance" && e.repoComponent && e.visible !== false), [elements]);
  if (instances.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="repo-instances">
      <div ref={inner} style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0" }}>
        {instances.map((el, index) => {
          const ref = el.repoComponent!;
          const component = library.find((c) => c.file === ref.file && c.name === ref.name);
          const connected = !!connection && repoSlug(connection) === ref.repo && source?.repo === ref.repo;
          const at = absPos(el, elements);
          const selected = selectedIds.includes(el.id);
          const note = !connected ? `Connect ${ref.repo} to show ${ref.name}` : !component ? `${ref.name} isn't in the imported components` : index >= MAX_LIVE_INSTANCES ? `${ref.name}` : null;
          return (
            <div key={el.id}>
              <div
                data-instance={el.id}
                style={{ position: "absolute", left: at.x, top: at.y, width: el.width, height: el.height, overflow: "hidden", opacity: el.opacity, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin: "0 0" }}
              >
                {note || !component || !source || !connection ? (
                  <div style={{ font: "11px/1.4 ui-monospace, monospace", color: "#6366f1", padding: 6, width: "100%", height: "100%", border: "1px dashed #6366f1", borderRadius: 6, background: "rgba(99,102,241,0.08)" }}>{note}</div>
                ) : (
                  <InstanceFrame el={el} component={component} source={source} connection={connection} dark={dark} overrides={overrides} onSize={setMeasuredSize} />
                )}
              </div>
              {selected && (
                <div style={{ position: "absolute", left: at.x, top: at.y, width: el.width, height: el.height, outline: "calc(2px / var(--zoom, 1)) solid #6366f1", transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin: "0 0" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InstanceFrame({ el, component, source, connection, dark, overrides, onSize }: {
  el: CanvasElement;
  component: Parameters<typeof PreviewFrame>[0]["component"];
  source: NonNullable<ReturnType<typeof useLibraryStore.getState>["source"]>;
  connection: NonNullable<ReturnType<typeof useGitStore.getState>["connection"]>;
  dark: boolean;
  overrides: string;
  onSize: (id: string, width: number, height: number) => void;
}) {
  const props = useMemo(() => ({ ...initialProps(component), ...(el.instanceProps ?? {}) }), [component, el.instanceProps]);
  const fit = el.autoSize !== false;
  return (
    <PreviewFrame
      component={component}
      source={source}
      connection={connection}
      props={props}
      fit={fit}
      width={el.width}
      dark={dark}
      overrides={overrides}
      // A size is taken from the component only while it hasn't been resized by hand.
      onSize={(w, h) => { if (fit) onSize(el.id, w, h); }}
    />
  );
}
