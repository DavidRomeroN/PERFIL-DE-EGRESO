import type { Metadata } from "next";
import { ReportesAdmin } from "./reportes-admin";

export const metadata: Metadata = { title: "Reportes" };

export default function Page() {
  return <ReportesAdmin />;
}
