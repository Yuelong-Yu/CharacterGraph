import Link from "next/link";
import { listProjects } from "@/lib/data";
import { COLOR, FONT } from "@/lib/tokens";

export default function Home() {
  const projects = listProjects();

  return (
    <main
      style={{
        minHeight: "100%",
        background: COLOR.bg,
        color: COLOR.text,
        fontFamily: FONT.sans,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "96px 32px",
      }}
    >
      <header style={{ maxWidth: 1080, width: "100%", marginBottom: 56 }}>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 12,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: COLOR.textMuted,
            marginBottom: 14,
          }}
        >
          CharacterGraph
        </div>
        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: 56,
            lineHeight: 1.05,
            margin: 0,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          人物关系图谱
        </h1>
        <p style={{ marginTop: 16, fontSize: 15, color: COLOR.textMuted, maxWidth: 560, lineHeight: 1.7 }}>
          选择一个图谱进入 3D 关系网络。每个图谱拥有独立的人物、神器、关系与视觉体系。
        </p>
      </header>

      <section
        style={{
          maxWidth: 1080,
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 24,
        }}
      >
        {projects.length === 0 && (
          <div style={{ color: COLOR.textMuted, fontSize: 14 }}>
            尚无可用图谱。在 <code>projects/&lt;slug&gt;/</code> 下放入 project.config.json 与数据即可出现在此。
          </div>
        )}
        {projects.map((p) => (
          <Link key={p.slug} href={`/${p.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
            <ProjectCard slug={p.slug} title={p.title} subtitle={p.subtitle} cover={p.cover} />
          </Link>
        ))}
      </section>
    </main>
  );
}

function ProjectCard({
  slug,
  title,
  subtitle,
  cover,
}: {
  slug: string;
  title: string;
  subtitle: string | null;
  cover: string | null;
}) {
  return (
    <article
      style={{
        border: `1px solid ${COLOR.border}`,
        borderRadius: 14,
        overflow: "hidden",
        background: COLOR.bgRaised,
        transition: "transform 180ms ease, box-shadow 180ms ease",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
      className="project-card"
    >
      <div
        style={{
          aspectRatio: "16 / 10",
          background: cover
            ? `center / cover no-repeat url(${cover})`
            : "linear-gradient(135deg, #2e2a3a 0%, #4a2f2a 100%)",
          display: "flex",
          alignItems: "flex-end",
          padding: 18,
        }}
      >
        {!cover && (
          <span style={{ fontFamily: FONT.serif, fontSize: 48, color: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
            {title.slice(0, 2)}
          </span>
        )}
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 24, fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: COLOR.textMuted, lineHeight: 1.6 }}>{subtitle}</div>}
        <div
          style={{
            marginTop: 8,
            fontFamily: FONT.mono,
            fontSize: 11,
            letterSpacing: "0.12em",
            color: COLOR.accent,
          }}
        >
          进入图谱 →
        </div>
      </div>
      <style>{`
        .project-card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,0.12); }
      `}</style>
    </article>
  );
}
