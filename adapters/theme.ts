/**
 * The bar's `Theme` adapter (spine AD-13; doc 101 §4 named no port, §11 named
 * the seam; REQ-013 Phase A).
 *
 * The pure port + core live in `../ports/theme`; this file supplies the host:
 * the two stable runtime artifacts, the display, and the ONE file monitor.
 *
 * ONE PROVIDER, COMPOSED. The provider carries the legacy `colors.css` content
 * verbatim (so every current `@color_*` app is unchanged) plus one
 * `@define-color <role> <hex>;` per palette role (so Phase B apps can use role
 * names). Composing one sheet is what keeps the one-provider invariant: each
 * refresh creates and adds the next provider, THEN removes the previous one
 * (BUG-001, `docs/ags-restart-vs-live-theme-refresh.md` §9-24).
 *
 * WHY NOT THE AGS APP HELPER. Its CSS entry point creates, adds and retains a
 * provider on every call, so routing palette refreshes through it accumulated
 * one provider per refresh (BUG-001). Here the adapter removes only the handle
 * it added itself, so the app stylesheet installed at app start and the GTK
 * theme are never touched.
 *
 * THE PATHS ARE THE STABLE POINTERS. `colors.css` is the provisioning-owned
 * symlink the runtime repoints at the current `colors.gtk.css` generation;
 * `colors.yaml` is the sibling current pointer the runtime repoints at the
 * current palette entry. The runtime writes a new immutable cache entry and
 * replaces the symlink, so the monitor fires on the RENAMED event of the link
 * itself (verified locally with `gjs` + `ln -sfn`: one RENAMED event per
 * repoint; writing through the link does not produce an event). Reading the
 * path, never the resolved generation, means a reload is never stale (F9).
 */

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import {
  createReplacingCssSink,
  createTheme,
  type CssProviderHandle,
  type CssProviderHost,
} from "../ports/theme";

//: The stable legacy palette artifact: colors.css -> current/colors.gtk.css.
const PALETTE_CSS = `${GLib.get_user_config_dir()}/ags/colors.css`;

//: The stable typed palette artifact: current/colors.yaml (runtime REQ-006).
const PALETTE_YAML = `${GLib.get_user_state_dir()}/dotfiles/current/colors.yaml`;

//: Collapse the burst of filesystem events one atomic symlink repoint emits.
const RELOAD_DEBOUNCE_MS = 50;

/**
 * Resolve the display lazily: importing this module must not require a live
 * display before `app.start()` has run.
 */
function defaultDisplay(): Gdk.Display {
  const display = Gdk.Display.get_default();
  if (display === null) throw new Error("no default GDK display");
  return display;
}

function readText(path: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error("not readable");
    return new TextDecoder().decode(bytes);
  } catch (error) {
    throw new Error(`theme: cannot read ${path}: ${error}`);
  }
}

const gtkProviderHost: CssProviderHost = {
  add(css: string): Gtk.CssProvider {
    const provider = new Gtk.CssProvider();
    // One sheet: the legacy stylesheet plus the role block, applied together.
    provider.load_from_string(css);
    Gtk.StyleContext.add_provider_for_display(
      defaultDisplay(),
      provider,
      Gtk.STYLE_PROVIDER_PRIORITY_USER,
    );
    return provider;
  },
  remove(provider: CssProviderHandle): void {
    Gtk.StyleContext.remove_provider_for_display(
      defaultDisplay(),
      provider as Gtk.CssProvider,
    );
  },
};

/**
 * ONE `Gio.FileMonitor` on the palette path, shared by every subscriber (the
 * Theme core starts it on the first subscribe and releases it on the last
 * unsubscribe). Events are debounced so one atomic repoint produces one
 * reload, after which the core parses the new palette and notifies listeners.
 */
function watchPalette(path: string, onChange: () => void): () => void {
  const monitor = Gio.File.new_for_path(path).monitor_file(
    Gio.FileMonitorFlags.WATCH_MOVES,
    null,
  );
  let pending: number | null = null;
  const schedule = (): void => {
    if (pending !== null) return;
    pending = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RELOAD_DEBOUNCE_MS,
      () => {
        pending = null;
        onChange();
        return GLib.SOURCE_REMOVE;
      },
    );
  };
  const handler = monitor.connect("changed", schedule);
  return (): void => {
    if (pending !== null) {
      GLib.source_remove(pending);
      pending = null;
    }
    try {
      monitor.disconnect(handler);
    } catch {
      /* already disconnected */
    }
    try {
      monitor.cancel();
    } catch {
      /* already cancelled */
    }
  };
}

//: The bar's one Theme; app.tsx calls `theme.apply()` in main().
export const theme = createTheme({
  legacyCssPath: PALETTE_CSS,
  palettePath: PALETTE_YAML,
  sink: createReplacingCssSink(gtkProviderHost),
  readFile: readText,
  watchFile: watchPalette,
});
