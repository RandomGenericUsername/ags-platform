/**
 * ags-platform — the public surface of the in-place platform package.
 *
 * Spine AD-17/AD-20: the platform is extracted IN-PLACE in dotfiles-v3 first,
 * then published. This package root is that extraction: the ports, the shared
 * adapters, and the one event client, in one unit with one entry point.
 *
 * PORTS (`./ports/*`) are PURE — no `gi://`, no `ags` — so they typecheck and
 * unit-test with no desktop stack (AD-2/AD-4). ADAPTERS (`./adapters/*`) bind
 * those ports to the host (Gio, Gtk, gnim). Consumers that resolve the package
 * by bare specifier (AD-17's `node_modules` shortcut) import the subpaths
 * declared in `package.json`'s `exports` map.
 *
 * The re-exports are EXPLICIT, not `export *`: `adapters/icon` re-exports the
 * icon contract it binds, so a star would collide.
 */

// --- ports: the pure platform surface (AD-4/AD-5/AD-7/AD-11/AD-12/AD-13) ---

export {
  CAPTURE_STATE_TOPIC,
  CONTROL_METHOD,
  DBUS_BUS_NAME,
  DBUS_OBJECT_PATH,
  DOMAIN_EVENT_SIGNAL,
  EMIT_METHOD,
  EVENTS_BUS_NAME,
  EVENTS_INTERFACE,
  EVENTS_OBJECT_PATH,
  HYDRATION_METHOD,
  HYDRATION_TIMEOUT_MS,
  JOBS_CLEARED_SIGNAL,
  NAME_OWNER_CHANGED_SIGNAL,
  RESERVED_EPOCH,
  RESERVED_SEQ,
  SPEEDTEST_STATE_TOPIC,
  DomainEventBusCore,
  asUint,
  isNewer,
  parseTopicState,
} from "./ports/event-client";
export type {
  DomainPayload,
  EventBusTransport,
  EventHub,
  EventMap,
  EventPayload,
  EventSource,
  Pair,
  ParsedTopicState,
  RestartHandler,
  TopicHandler,
} from "./ports/event-client";

export { iconByStateKey, iconByVariant, resolveIconSource } from "./ports/icon-source";
export type { IconBarMapping, IconProvider, IconRef, IconSource } from "./ports/icon-source";

export { createPreferences } from "./ports/preferences";
export type { Preferences, PreferencesSource } from "./ports/preferences";

export { createNotifier, isCardIntent } from "./ports/notifier";
export type { NotificationIntent, Notifier, NotifierSinks } from "./ports/notifier";

export { contentSignature, createOverlayLifecycle } from "./ports/overlay-lifecycle";
export type {
  OverlayHooks,
  OverlayLifecycle,
  OverlayScheduler,
} from "./ports/overlay-lifecycle";

// --- app contract: manifest + palette-refresh + template conformance (REQ-012) ---

export {
  AGS_APP_MANIFEST_FILE,
  AGS_APP_MANIFEST_SCHEMA_VERSION,
  AGS_APP_PATH_SEGMENT_PATTERN,
  parseAgsAppManifest,
  validateAgsAppManifest,
} from "./ports/app-manifest";
export type {
  AgsAppManifest,
  AgsAppManifestIssue,
  AgsAppManifestLive,
  AgsAppManifestRestart,
  AgsAppManifestValidation,
  AgsAppMode,
} from "./ports/app-manifest";

export {
  PALETTE_REFRESH_COMMAND,
  createPaletteRefreshHandler,
} from "./ports/palette-refresh";
export type {
  PaletteRefresh,
  PaletteRefreshRequestHandler,
  PaletteRefreshResult,
} from "./ports/palette-refresh";

export { AGS_APP_REQUIRED_FILES, checkAppRepo } from "./ports/app-conformance";
export type {
  AppConformanceIssue,
  AppConformanceOptions,
  AppConformanceReport,
  AppRepoReader,
} from "./ports/app-conformance";

export { createReplacingCssSink, createTheme } from "./ports/theme";
export type { CssProviderHandle, CssProviderHost, CssSink, Theme } from "./ports/theme";

export type { ReactiveRuntime, ReadAccessor, Setter } from "./ports/reactive";

// --- adapters: the host bindings and the bound singletons the bar uses ---

export { agsRuntime } from "./adapters/astal";
export { domainEvents, publishSpeedTestState } from "./adapters/event-bus";
export type {
  SpeedTestMeasurements,
  SpeedTestReason,
  SpeedTestState,
  SpeedTestTrigger,
} from "./adapters/event-bus";
export { manifestSchemaVersion, registry } from "./adapters/icon-registry";
export { registryProvider, resolveIcon } from "./adapters/icon";
export { notifier } from "./adapters/notifier";
export { idleScheduler, overlayLifecycle } from "./adapters/overlay-lifecycle";
export { preferences } from "./adapters/preferences";
export { theme } from "./adapters/theme";
