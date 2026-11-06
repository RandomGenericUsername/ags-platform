/**
 * The display-side Skin adapter (frozen Skin Spec v1).
 *
 * The pure port + core live in `../ports/skin`; this file owns the host:
 * the two XDG pointers, the display, and the `Gio.FileMonitor`s.
 *
 * ## One provider, USER priority, last installed
 *
 * The composed sheet is the runtime palette block (`colors.css` +
 * `colors.yaml` role defines) followed by the runtime-expanded `skin.css`.
 * It is installed as ONE `Gtk.CssProvider` at
 * `Gtk.STYLE_PROVIDER_PRIORITY_USER` (800). AGS installs `app.start({ css })`
 * at USER too, so:
 *
 * - a skin at APPLICATION priority (600) silently loses every conflict; and
 * - the skin provider must be the LAST-installed provider on every swap.
 *
 * The replacing sink adds the next provider BEFORE removing the previous one,
 * so the skin is always the newest provider and no frame is skinless. The app
 * stylesheet and GTK theme are never removed or modified.
 *
 * ## GC-safe monitors
 *
 * A `Gio.FileMonitor` held only by a local closure can be collected and then
 * silently stop emitting (this killed a live probe). Every monitor this module
 * creates is also retained in the module-scoped `activeMonitors` set until its
 * release handle runs; providers are retained the same way. The pure core
 * shares one watcher per artifact across listeners and releases both when the
 * last unsubscribe runs.
 *
 * ## Palette independence
 *
 * This adapter does not expand a skin. It reads the runtime-expanded
 * `skin.css` bytes and composes them with the live palette; composition is the
 * only transformation.
 */

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { agsRuntime } from "./astal";
import type { ReadAccessor } from "../ports/reactive";
import {
  createReplacingSkinCssSink,
  createSkin,
  createSkinValue,
  type SkinCssHost,
  type SkinTokenValue,
} from "../ports/skin";
import type { CssProviderHandle } from "../ports/theme";

//: Runtime-owned pointer, mirrored here as a constant: config/ags/skin.css.
export const SKIN_CSS_POINTER = "ags/skin.css";
//: Runtime-owned pointer, mirrored here as a constant:
//: state/dotfiles/current/skin.json (the resolved token map).
export const SKIN_JSON_POINTER = "dotfiles/current/skin.json";

/** `$XDG_CONFIG_HOME/ags/skin.css` — runtime-expanded skin CSS. */
export const SKIN_CSS_PATH = `${GLib.get_user_config_dir()}/${SKIN_CSS_POINTER}`;
/** `$XDG_STATE_HOME/dotfiles/current/skin.json` — resolved token map. */
export const SKIN_JSON_PATH = `${GLib.get_user_state_dir()}/${SKIN_JSON_POINTER}`;
/** The stable legacy palette sheet the provider prefix comes from. */
export const SKIN_LEGACY_CSS_PATH = `${GLib.get_user_config_dir()}/ags/colors.css`;
/** The typed palette the provider prefix comes from. */
export const SKIN_PALETTE_PATH = `${GLib.get_user_state_dir()}/dotfiles/current/colors.yaml`;

//: Collapse the burst of filesystem events one atomic symlink repoint emits.
const RELOAD_DEBOUNCE_MS = 50;

/**
 * Module-scoped retention. The sink/core also hold these, but keeping the
 * references here makes the GC contract explicit: a monitor or provider must
 * outlive the callback closure that created it.
 */
const activeMonitors = new Set<Gio.FileMonitor>();
const activeProviders = new Set<CssProviderHandle>();

/** Resolve the display lazily: module import must not need a live display. */
function defaultDisplay(): Gdk.Display {
  const display = Gdk.Display.get_default();
  if (display === null) throw new Error("no default GDK display");
  return display;
}

/**
 * Read a UTF-8 artifact. `null` means absent (the skin core treats that as a
 * no-op); an unreadable/undecodable artifact throws and is reported.
 */
function readText(path: string): string | null {
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok || bytes === null) return null;
    return new TextDecoder().decode(bytes);
  } catch (error) {
    throw new Error(`skin: cannot read ${path}: ${error}`);
  }
}

const gtkSkinHost: SkinCssHost = {
  add(css: string, priority: number): Gtk.CssProvider {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(css);
    // `priority` is supplied by createReplacingSkinCssSink and is always
    // SKIN_PROVIDER_PRIORITY (USER = 800).
    Gtk.StyleContext.add_provider_for_display(defaultDisplay(), provider, priority);
    activeProviders.add(provider);
    return provider;
  },
  remove(provider: CssProviderHandle): void {
    activeProviders.delete(provider);
    Gtk.StyleContext.remove_provider_for_display(
      defaultDisplay(),
      provider as Gtk.CssProvider,
    );
  },
};

/**
 * One `Gio.FileMonitor` per skin artifact, with a 50 ms debounce. The core
 * starts these on the first subscriber and calls both release handles on the
 * last unsubscribe. The monitor is retained in `activeMonitors` while live so
 * it cannot be GC-collected between events.
 */
function watchSkin(path: string, onChange: () => void): () => void {
  let monitor: Gio.FileMonitor;
  try {
    monitor = Gio.File.new_for_path(path).monitor_file(
      Gio.FileMonitorFlags.WATCH_MOVES,
      null,
    );
  } catch (error) {
    console.error(`skin: cannot watch ${path}: ${error}`);
    return () => {};
  }
  activeMonitors.add(monitor);

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
    activeMonitors.delete(monitor);
  };
}

//: The app's one Skin; app.tsx calls `skin.apply()` in main().
export const skin = createSkin({
  skinCssPath: SKIN_CSS_PATH,
  skinJsonPath: SKIN_JSON_PATH,
  legacyCssPath: SKIN_LEGACY_CSS_PATH,
  palettePath: SKIN_PALETTE_PATH,
  sink: createReplacingSkinCssSink(gtkSkinHost),
  readFile: readText,
  watchFile: watchSkin,
});

/**
 * Reactive rhythm/layout accessor. The returned function is accessor
 * compatible (callable, `.peek()`), so widgets read the token without
 * remounting when a skin reload swaps the provider. Missing or invalid tokens
 * return `fallback`.
 *
 * ```ts
 * const width = skinValue("panel-width", 360)
 * const spacing = skinValue("layout.bt-list-spacing", 6)
 * ```
 */
export function skinValue<T extends SkinTokenValue>(
  key: string,
  fallback: T,
): ReadAccessor<T> {
  return createSkinValue(skin, agsRuntime, key, fallback);
}
