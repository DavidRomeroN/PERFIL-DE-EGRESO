import type { Metadata } from "next";
import { VentanillasAdmin } from "./ventanillas-admin";

export const metadata: Metadata = { title: "Ventanillas" };

export default function Page() {
  return <VentanillasAdmin />;
}
