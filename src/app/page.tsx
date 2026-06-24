import { loadDataset } from "@/lib/data";
import { GraphShell } from "@/components/GraphShell";
import { SWRegister } from "@/components/SWRegister";

export default function Home() {
  const dataset = loadDataset();
  return (
    <>
      <SWRegister />
      <GraphShell dataset={dataset} />
    </>
  );
}
