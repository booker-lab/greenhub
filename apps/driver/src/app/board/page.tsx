"use client";

import dynamic from "next/dynamic";

const BoardClient = dynamic(() => import("./_client"), { ssr: false });

export default function BoardPage() {
  return <BoardClient />;
}
