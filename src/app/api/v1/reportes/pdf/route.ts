import { conRol } from "@/lib/api";
import { localDeSesion } from "@/lib/admin";
import { prisma } from "@/lib/db";

function pdfTexto(lineas: string[]) {
  const contenido = lineas.map((l, i) => `BT /F1 12 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const stream = `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`;
  const objetos = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj ${stream} endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let cuerpo = "%PDF-1.4\n";
  const offs = [0];
  for (const o of objetos) {
    offs.push(cuerpo.length);
    cuerpo += o + "\n";
  }
  const xref = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offs.length; i++) cuerpo += `${String(offs[i]).padStart(10, "0")} 00000 n \n`;
  cuerpo += `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return cuerpo;
}

export const GET = conRol(["ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const local = await prisma.local.findUnique({ where: { id: localId } });
  const total = await prisma.turno.count({ where: { localId } });
  const atendidos = await prisma.turno.count({ where: { localId, estado: "ATENDIDO" } });
  const bytes = pdfTexto([
    `TurnoYa - ${local?.nombreComercial ?? "Local"}`,
    `Turnos registrados: ${total}`,
    `Atendidos: ${atendidos}`,
    `Generado: ${new Date().toLocaleString("es-PE")}`,
  ]);
  return new Response(bytes, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=reporte-turnoya.pdf" },
  });
});
