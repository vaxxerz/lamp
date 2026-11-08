import { AppHeader } from "@/components/AppHeader";

export default function StudentLayout({ children }: LayoutProps<"/student">) {
  return (
    <>
      <AppHeader home="/student" />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">{children}</div>
    </>
  );
}
