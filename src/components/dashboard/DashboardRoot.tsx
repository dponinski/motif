"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("./Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-screen h-screen bg-[#0a0a0a]">
      <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  ),
});

export default function DashboardRoot() {
  return <Dashboard />;
}
