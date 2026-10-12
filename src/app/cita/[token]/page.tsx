import { redirect } from "next/navigation";

/** Compatibilidad: la página de la cita ahora vive en /c/:token (M3). */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/c/${token}`);
}
