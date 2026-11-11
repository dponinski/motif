"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Editor from "./Editor";
import { useFilesStore } from "@/store/files";

export default function EditorRoot() {
  const params = useParams();
  const router = useRouter();
  const fileId = params?.id as string;
  const files = useFilesStore((s) => s.files);

  // Redirect to dashboard if the file no longer exists (after files load from localStorage)
  useEffect(() => {
    if (!fileId) {
      router.replace("/");
      return;
    }
    // Only redirect once the store has hydrated (files array may be empty initially)
    if (files.length > 0 && !files.find((f) => f.id === fileId)) {
      router.replace("/");
    }
  }, [fileId, files, router]);

  return <Editor fileId={fileId} />;
}
