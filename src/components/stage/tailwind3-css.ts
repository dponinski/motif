import { isFromPreview } from "@/lib/preview/protocol";

// Builds the stylesheet of a Tailwind 3 page by running the page itself, out of sight, and asking it for what it built once it has drawn.
// A page that has to run without Motif (documentation, an exported site) carries that instead of the engine.
export function builtTailwind3Css(srcdoc: string, timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Stylesheet build";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    // Out of sight but laid out, so the page is drawn the way it would be shown (a page that isn't laid out gets no frames).
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden;pointer-events:none";
    let failure: string | null = null;
    const finish = (done: () => void) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      done();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !isFromPreview(event.data)) return;
      if (event.data.type === "ready") frame.contentWindow?.postMessage({ type: "tailwind3css" }, "*");
      else if (event.data.type === "error") failure ??= event.data.message;
      else if (event.data.type === "tailwind3css") {
        const css = event.data.css;
        // A build that failed has nothing to carry; a page that built is used whatever else it complained of.
        finish(() => (css ? resolve(css) : reject(new Error(failure ?? "The page's stylesheet came out empty"))));
      }
    };
    const timer = setTimeout(() => finish(() => reject(new Error(failure ?? "Building the page's stylesheet took too long"))), timeoutMs);
    window.addEventListener("message", onMessage);
    frame.srcdoc = srcdoc;
    document.body.appendChild(frame);
  });
}
