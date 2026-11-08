"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function Dialog({
  children,
  close,
  labelId,
}: {
  children: ReactNode;
  close: () => void;
  labelId: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="lamp-native-dialog"
      aria-labelledby={labelId}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {children}
    </dialog>
  );
}
