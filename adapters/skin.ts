/**
 * The display-side Skin adapter (frozen Skin Spec v1).
 *
 * The pure port + core live in `../ports/skin`; this file owns the host:
 * the XDG pointers, the display, and the `Gio.FileMonitor`s.
 *
 * ## App scope
 *
 * `createAppSkin({ configDir })` builds one instance per AGS app. Only the CSS
 * pointer is app-scoped (`$XDG_CONFIG_HOME/<configDir>/skin.css`); the token
 * map (`current/skin.json`) and both palette artifacts are shared. The
 * exported `skin` singleton is exactly `createAppSkin({ configDir: "ags" })`,
 * so the bar's existing imports and behavior are unchanged. The platform has
 * no app list: `configDir` is always an input.
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
  createSkinValue,
  type Skin,
  type SkinCssHost,
  type SkinCssSink,
  type SkinTokenValue,
} from "../ports/skin";
import type { CssProviderHandle } from "../ports/theme";
import { createScopedSkin } from "./skin-scope";

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

/**
 * Options for one app-scoped Skin. `configDir` is the consumer's AGS config
 * directory (`ags` for the bar, `ags-clipboard`, `ags-notifications`, …).
 * The host hooks are overridable for tests; production apps pass only
 * `configDir`.
 */
export interface AppSkinOptions {
  /** AGS config directory name, e.g. `ags` or `ags-clipboard`. */
  configDir: string;
  /** Override the provider sink (default: this app's replacing GTK sink). */
  sink?: SkinCssSink;
  /** Override the artifact reader (default: GLib). */
  readFile?(path: string): string | null;
  /** Override the artifact watcher (default: debounced Gio monitor). */
  watchFile?(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/**
 * @deprecated v0.9.0 — kept for one release while apps migrate to Appearance.
 * New code uses `createAppearance({ configDir })`, which watches the one
 * `current/appearance` hop and applies palette + skin as one composed sheet.
 *
 * Build a Skin scoped to one AGS app's config directory.
 *
 * Resolves `$XDG_CONFIG_HOME/<configDir>/skin.css` and the shared
 * `$XDG_STATE_HOME/dotfiles/current/skin.json` + palette artifacts. Each call
 * owns its own provider sink and watchers, so two app instances never share
 * display state.
 *
 * ```ts
 * const skin = createAppSkin({ configDir: "ags-clipboard" })
 * skin.apply()
 * const width = createAppSkinValue(skin, "layout.panel-width", 360)
 * ```
 */
export function createAppSkin(options: AppSkinOptions): Skin {
  return createScopedSkin({
    configDir: options.configDir,
    configHome: GLib.get_user_config_dir(),
    stateHome: GLib.get_user_state_dir(),
    // A fresh sink per instance: the provider handle is instance state.
    sink: options.sink ?? createReplacingSkinCssSink(gtkSkinHost),
    readFile: options.readFile ?? readText,
    watchFile: options.watchFile ?? watchSkin,
    onError: options.onError,
  });
}

/**
 * @deprecated v0.9.0 — use `appearance` / `createAppearance()` instead. This
 * v1 singleton remains exported for one release so existing bar imports keep
 * working; it watches the obsolete skin artifacts and installs a separate
 * provider.
 *
 * The bar's Skin; app.tsx calls `skin.apply()` in main(). Same configDir the
 * runtime uses for the bar (`ags`), so existing bar behavior is unchanged.
 */
export const skin = createAppSkin({ configDir: "ags" });

/**
 * @deprecated v0.9.0 — use `appearance.value("layout.<app>.<token>", fallback)`
 * or `createAppearanceValue` on an Appearance source.
 *
 * Reactive rhythm/layout accessor bound to a specific app-scoped Skin. Use
 * this in a non-bar app; the bar keeps the shorter `skinValue` over its
 * default `skin` singleton.
 *
 * The returned function is accessor compatible (callable, `.peek()`), so
 * widgets read the token without remounting when a skin reload swaps the
 * provider. Missing or invalid tokens return `fallback`.
 *
 * ```ts
 * const skin = createAppSkin({ configDir: "ags-clipboard" })
 * skin.apply()
 * const width = createAppSkinValue(skin, "layout.panel-width", 360)
 * ```
 */
export function createAppSkinValue<T extends SkinTokenValue>(
  source: Skin,
  key: string,
  fallback: T,
): ReadAccessor<T> {
  return createSkinValue(source, agsRuntime, key, fallback);
}

/**
 * @deprecated v0.9.0 — use `appearance.value("layout.<app>.<token>", fallback)`.
 *
 * Reactive rhythm/layout accessor for the bar's default `skin` singleton. The
 * returned function is accessor compatible (callable, `.peek()`), so widgets
 * read the token without remounting when a skin reload swaps the provider.
 * Missing or invalid tokens return `fallback`.
 *
 * Non-bar apps build their own instance and use `createAppSkinValue`.
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
  return createAppSkinValue(skin, key, fallback);
}
