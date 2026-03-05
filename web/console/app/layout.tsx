import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AIFutureCity",
  description: "AIFutureCity platform dashboard and OpenClaw integration console.",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{props.children}</body>
    </html>
  );
}
