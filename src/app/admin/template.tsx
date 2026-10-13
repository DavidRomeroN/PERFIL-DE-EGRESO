/** Cada página del admin entra con un fundido corto al navegar (el template se remonta en cada ruta). */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-[enter_320ms_var(--ease-out)_backwards] motion-reduce:animate-[fade-in-only_200ms_ease-out_backwards]">{children}</div>;
}
