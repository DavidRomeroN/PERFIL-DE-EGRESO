import type { Metadata } from "next";
import { ColasAdmin } from "./colas-admin";

export const metadata: Metadata = { title: "Colas y servicios" };

export default function Page() {
  return <ColasAdmin />;
}
