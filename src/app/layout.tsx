import { ChronChaosNav } from "@/components/ChronChaosNav";
import "@/components/chronChaosNav.css";

export const metadata = {
  title: "CharacterGraph — 人物关系图谱",
  description: "以节点与边的形式探索不同作品/神话的人物与关系",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "oklch(99% 0 0)", color: "oklch(20% 0.012 270)" }}>
        <div className="charactergraph-app">
          <ChronChaosNav />
          <div className="charactergraph-content">{children}</div>
        </div>
        <style>{`
          html, body { height: 100%; }
          .charactergraph-app { height: 100vh; height: 100dvh; overflow: hidden; }
          .charactergraph-content { height: calc(100vh - 68px); overflow: auto; }
          @media (max-width: 1023px) {
            .charactergraph-content {
              height: calc(100dvh - 56px);
              overflow: hidden;
            }
          }
        `}</style>
      </body>
    </html>
  );
}
