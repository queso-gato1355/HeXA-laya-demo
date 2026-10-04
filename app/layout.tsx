import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Laya 배달로봇 판단 시연",
  description: "보도 주행 로봇 영상 + GPS 재생과 로컬 Laya 결정 모델의 기준별 판단 (시연 전용)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
