import { z } from "zod";

const versionSchema = z.object({ version: z.string().min(1) });
const editableSelector = "input, textarea, select, [contenteditable='true']";

function fieldValue(element: Element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return String(element.checked);
    if (element.type === "file") return String(element.files?.length ?? 0);
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return element.textContent ?? "";
}

/** Defers a new deployment while an editor, dialog, or changed field is still open. */
export function watchDeployment(version: string) {
  const originals = new Map<Element, string>();
  const changed = new Set<Element>();
  const controller = new AbortController();
  let checking = false;
  let updated = false;
  let lastCheck = 0;
  const remember = (event: Event) => {
    const field = event.target instanceof Element ? event.target.closest(editableSelector) : null;
    if (field && !originals.has(field)) originals.set(field, fieldValue(field));
  };
  const edit = (event: Event) => {
    const field = event.target instanceof Element ? event.target.closest(editableSelector) : null;
    if (!field) return;
    if (originals.get(field) === fieldValue(field)) changed.delete(field);
    else changed.add(field);
  };
  const reloadWhenSafe = () => {
    if (!updated || document.visibilityState !== "visible" || !navigator.onLine) return;
    for (const field of changed) if (!field.isConnected) changed.delete(field);
    if (changed.size || document.querySelector("dialog[open], [aria-busy='true']")) return;
    if (document.activeElement?.matches(editableSelector)) return;
    window.location.reload();
  };
  const check = async () => {
    if (controller.signal.aborted || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (updated) return reloadWhenSafe();
    if (checking || Date.now() - lastCheck < 5_000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const response = await fetch(`/api/version?t=${lastCheck}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      });
      if (!response.ok || controller.signal.aborted) return;
      const result = versionSchema.safeParse(await response.json());
      if (!controller.signal.aborted && result.success && result.data.version !== version) {
        updated = true;
        reloadWhenSafe();
      }
    } catch (error) {
      // A disconnected browser or a deployment in progress is retried on the next check.
      if (!(error instanceof TypeError || error instanceof DOMException || error instanceof SyntaxError)) throw error;
    } finally {
      checking = false;
    }
  };
  document.addEventListener("focusin", remember);
  document.addEventListener("beforeinput", remember);
  document.addEventListener("input", edit);
  document.addEventListener("change", edit);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  const timer = setInterval(check, 30_000);
  void check();
  return () => {
    controller.abort();
    clearInterval(timer);
    document.removeEventListener("focusin", remember);
    document.removeEventListener("beforeinput", remember);
    document.removeEventListener("input", edit);
    document.removeEventListener("change", edit);
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
  };
}
