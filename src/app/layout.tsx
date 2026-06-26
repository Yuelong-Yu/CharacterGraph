export const metadata = {
  title: "CharacterGraph — 人物关系图谱",
  description: "以节点与边的形式探索不同作品/神话的人物与关系",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "oklch(99% 0 0)", color: "oklch(20% 0.012 270)" }}>
        <div className="desktop-only">{children}</div>
        <div className="mobile-block">
          <div>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 40, marginBottom: 16 }}>
              CharacterGraph
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.8, color: "oklch(45% 0.012 270)", maxWidth: 280 }}>
              本图谱为桌面端深度体验设计。<br />
              请用 <strong style={{ color: "oklch(20% 0.012 270)" }}>电脑浏览器</strong> 访问以获得完整体验。
            </div>
          </div>
        </div>
        <style>{`
          html, body { height: 100%; }
          .mobile-block { display: none; }
          @media (max-width: 1023px) {
            .desktop-only { display: none !important; }
            .mobile-block {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 32px;
              text-align: center;
            }
          }
        `}</style>
      </body>
    </html>
  );
}
