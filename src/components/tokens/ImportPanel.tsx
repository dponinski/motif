"use client";

import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { X } from "lucide-react";
import { useDesignSystemStore } from "@/store/design-system";
import { editTokens } from "@/store/token-history";

// Tokens from a W3C design tokens file, pasted in.
export default function ImportPanel({ onClose }: { onClose: () => void }) {
  const { importFromJSON } = useDesignSystemStore(useShallow((s) => ({ importFromJSON: s.importFromJSON })));
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  const handleImport = () => {
    const result = editTokens(() => importFromJSON(text));
    if (result.errors.length) {
      setMsg(`Errors: ${result.errors.join(", ")}`);
    } else {
      setMsg(`Imported ${result.imported} tokens`);
      setTimeout(onClose, 1200);
    }
  };

  return (
    <div className="border-t border-surface-border p-4 bg-surface-raised flex-shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-sm font-medium text-text-primary flex-1">Import W3C JSON</p>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={13} /></button>
      </div>
      <textarea
        className="w-full bg-surface-subtle border border-surface-border rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent font-mono resize-none"
        rows={6}
        placeholder={'{"color": {"primary": {"500": {"$value": "#6366f1", "$type": "color"}}}}'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {msg && <p className="text-2xs mt-1 text-accent">{msg}</p>}
      <div className="flex gap-2 mt-2">
        <button onClick={handleImport} className="flex-1 bg-accent hover:bg-accent/90 text-white text-xs py-1.5 rounded transition-colors">Import</button>
        <button onClick={onClose} className="flex-1 border border-surface-border text-text-secondary hover:text-text-primary text-xs py-1.5 rounded transition-colors">Cancel</button>
      </div>
    </div>
  );
}
