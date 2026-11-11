"use client";

import dynamic from "next/dynamic";

const EditorRoot = dynamic(() => import("./EditorRoot"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-screen h-screen bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <span className="text-[11px] text-[#555]">Loading Motif...</span>
      </div>
    </div>
  ),
});

export default function EditorPageRoot() {
  return <EditorRoot />;
}
