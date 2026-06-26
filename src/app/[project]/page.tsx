import { notFound } from "next/navigation";
import { listProjects, loadDataset } from "@/lib/data";
import { GraphShell } from "@/components/GraphShell";
import { SWRegister } from "@/components/SWRegister";

export function generateStaticParams() {
  return listProjects().map((p) => ({ project: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const found = listProjects().find((p) => p.slug === project);
  if (!found) return {};
  return {
    title: `${found.title} — CharacterGraph`,
    description: found.subtitle ?? undefined,
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!listProjects().some((p) => p.slug === project)) notFound();
  const loaded = loadDataset(project);
  return (
    <>
      <SWRegister />
      <GraphShell dataset={loaded.dataset} config={loaded.config} />
    </>
  );
}
