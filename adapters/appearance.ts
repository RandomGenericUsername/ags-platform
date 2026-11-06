/**
 * The display-side Appearance adapter (contracts `v0.7.0`).
 *
 * The pure port + core live in `../ports/appearance`; this file owns the host:
 * the XDG pointers, the display, the reactive runtime and the ONE
 * `Gio.FileMonitor`.
 *
 * ## One pointer, one hop
 *
 * The monitor is created on `$XDG_STATE_HOME/dotfiles/current/appearance`, the
 * entry the runtime actually repoints. The per-app
 * `$XDG_CONFIG_HOME/<configDir>/appearance.css` is a stable convenience link
 * INTO the current generation and is read after the event, never watched. This
 * is the v1 defect fixed: watching the stable first hop never saw a lower link
 * move.
 *
 * ## One provider, USER priority, last installed
 *
 * The provider carries the runtime-composed CSS VERBATIM (the palette
 * `@define-color` block followed by the expanded skin). It is installed as ONE
 * `Gtk.CssProvider` at `Gtk.STYLE_PROVIDER_PRIORITY_USER` (800). AGS installs
 * `app.start({ css })` at USER too, so the appearance provider must be the
 * last-installed provider on every swap. The replacing sink adds the next
 * provider BEFORE removing the previous one; the app stylesheet and GTK theme
 * are never touched.
 *
 * ## GC-safe refs
 *
 * A `Gio.FileMonitor` or provider held only by a local closure can be
 * collected and silently stop working. Every monitor/provider this module
 * creates is retained in a module-scoped set until its release handle runs.
 *
 * ## One apply per generation
 *
 * A repoint produces a burst and the runtime may also create the convenience
 * link. The core coalesces identical CSS + token content, so a generation is
 * applied once; the 50 ms debounce collapses the filesystem burst.
 */

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { agsRuntime } from "./astal";
import {
  APPEARANCE_PROVIDER_PRIORITY,
  createReplacingAppearanceCssSink,
  type Appearance,
  type AppearanceCssHost,
  type AppearanceCssSink,
} from "../ports/appearance";
import { createAppearanceRefreshHandler } from "../ports/appearance-refresh";
import type { CssProviderHandle } from "../ports/theme";
import { createScopedAppearance } from "./appearance-scope";

//: Runtime-owned pointer, mirrored here as a constant:
//: state/dotfiles/current/appearance (the ONLY monitored hop).
export const APPEARANCE_WATCH_POINTER = "dotfiles/current/appearance";

/** `$XDG_STATE_HOME/dotfiles/current/appearance` — the one repointed hop. */
export const APPEARANCE_WATCH_PATH = `${GLib.get_user_state_dir()}/${APPEARANCE_WATCH_POINTER}`;

/** The resolved token document behind the current pointer. */
export const APPEARANCE_TOKENS_PATH = `${APPEARANCE_WATCH_PATH}/tokens.json`;

/** The bar's composed sheet (`configDir = ags`). */
export const APPEARANCE_CSS_PATH = `${GLib.get_user_config_dir()}/ags/appearance.css`;

//: Collapse the burst of filesystem events one atomic symlink repoint emits.
const RELOAD_DEBOUNCE_MS = 50;

/**
 * Module-scoped retention. The core also holds these, but keeping the
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
 * Read a UTF-8 artifact. `null` means absent (the appearance core treats that
 * as a no-op); an unreadable/undecodable artifact throws and is reported.
 */
function readText(path: string): string | null {
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok || bytes === null) return null;
    return new TextDecoder().decode(bytes);
  } catch (error) {
    throw new Error(`appearance: cannot read ${path}: ${error}`);
  }
}

const gtkAppearanceHost: AppearanceCssHost = {
  add(css: string, priority: number): Gtk.CssProvider {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(css);
    // `priority` is supplied by createReplacingAppearanceCssSink and is always
    // APPEARANCE_PROVIDER_PRIORITY (USER = 800).
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
 * ONE `Gio.FileMonitor` on the appearance pointer, with a 50 ms debounce. The
 * core starts it on the first subscriber and releases it on the last
 * unsubscribe. It is retained in `activeMonitors` while live so it cannot be
 * GC-collected between events.
 */
function watchAppearance(path: string, onChange: () => void): () => void {
  let monitor: Gio.FileMonitor;
  try {
    monitor = Gio.File.new_for_path(path).monitor_file(
      Gio.FileMonitorFlags.WATCH_MOVES,
      null,
    );
  } catch (error) {
    console.error(`appearance: cannot watch ${path}: ${error}`);
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
 * Options for one app-scoped Appearance. `configDir` is the consumer's AGS
 * config directory (`ags` for the bar, `ags-clipboard`, `ags-notifications`, …).
 * The host hooks are overridable for tests; production apps pass only
 * `configDir`.
 */
export interface AppearanceAdapterOptions {
  /** AGS config directory name, e.g. `ags` or `ags-clipboard`. */
  configDir: string;
  /** Override the provider sink (default: this app's replacing GTK sink). */
  sink?: AppearanceCssSink;
  /** Override the reactive runtime (default: AGS/gnim). */
  runtime?: typeof agsRuntime;
  /** Override the artifact reader (default: GLib). */
  readFile?(path: string): string | null;
  /** Override the artifact watcher (default: debounced Gio monitor). */
  watchFile?(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/**
 * Build an Appearance scoped to one AGS app's config directory.
 *
 * Watches `$XDG_STATE_HOME/dotfiles/current/appearance`, reads
 * `$XDG_CONFIG_HOME/<configDir>/appearance.css` and the pointer's
 * `tokens.json`, and installs the composed sheet as one USER-priority
 * provider.
 *
 * ```ts
 * const appearance = createAppearance({ configDir: "ags-clipboard" })
 * appearance.apply()
 * const radius = appearance.value("surface.panel.radius", 12)
 * ```
 */
export function createAppearance(options: AppearanceAdapterOptions): Appearance {
  return createScopedAppearance({
    configDir: options.configDir,
    configHome: GLib.get_user_config_dir(),
    stateHome: GLib.get_user_state_dir(),
    // A fresh sink per instance: the provider handle is instance state.
    sink: options.sink ?? createReplacingAppearanceSink(),
    runtime: options.runtime ?? agsRuntime,
    readFile: options.readFile ?? readText,
    watchFile: options.watchFile ?? watchAppearance,
    onError: options.onError,
  });
}

/** The per-instance GTK sink, created lazily by the adapter. */
function createReplacingAppearanceSink(): AppearanceCssSink {
  // The pure sink owns the 800 constant and the add-before-remove ordering.
  return createReplacingAppearanceCssSink(gtkAppearanceHost);
}

//: The bar's Appearance; apps that need their own build one with configDir.
export const appearance = createAppearance({ configDir: "ags" });

export {
  APPEARANCE_PROVIDER_PRIORITY,
  createAppearanceRefreshHandler,
};
