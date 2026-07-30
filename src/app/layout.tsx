import { ChronChaosTopNavigation } from "@chronchaos/top-navigation";
import "@chronchaos/top-navigation/styles.css";

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
          <ChronChaosTopNavigation active="multiverse" />
          <div className="charactergraph-content">{children}</div>
        </div>
        <style>{`
          html, body { height: 100%; }
          .charactergraph-app {
            display: flex;
            flex-direction: column;
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
          }
          .charactergraph-content {
            flex: 1 1 auto;
            min-height: 0;
            overflow: auto;
          }
          @media (max-width: 1023px) {
            .charactergraph-content {
              overflow: hidden;
            }
          }
        `}</style>
      </body>
    </html>
  );
}
