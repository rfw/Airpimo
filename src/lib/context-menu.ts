/** Disable WebView context menus only for production builds. */
export function disableContextMenu(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
  production = import.meta.env?.PROD === true,
) {
  // Vite supplies import.meta.env; plain Node tests do not.
  if (!production) return () => {};

  const preventMenu = (event: MouseEvent) => event.preventDefault();
  target.addEventListener("contextmenu", preventMenu, true);
  return () => target.removeEventListener("contextmenu", preventMenu, true);
}
