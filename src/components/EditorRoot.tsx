"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Editor from "./Editor";
import { useProjectSession } from "@/store/project-session";

export default function EditorRoot() {
  const params = useParams();
  const router = useRouter();
  const projectId = (params?.id as string | undefined) ?? "";
  const session = useProjectSession(projectId);

  // There is nothing to edit without a project.
  useEffect(() => {
    if (session === "missing") router.replace("/");
  }, [session, router]);

  if (session !== "ready") {
    return <div className="w-screen h-screen bg-surface-base" />;
  }
  return <Editor projectId={projectId} />;
}
