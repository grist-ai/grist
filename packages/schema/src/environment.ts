export * as Environment from "./environment.js"

import { Schema } from "effect"
import { EnvironmentID, LOCAL_ENVIRONMENT_ID } from "./environment-id.js"
import { Project } from "./project.js"
import { AbsolutePath, DateTimeUtcFromMillis, optional } from "./schema.js"

export const ID = EnvironmentID
export type ID = EnvironmentID

export { LOCAL_ENVIRONMENT_ID }

/**
 * Environment names are slugs: they double as the worktree directory name
 * and the tail of the environment's branch (`grist/<name>-<short id>`), so
 * they stay lowercase, hyphenated, and short. `local` is reserved for
 * environment zero and can never name a stored environment.
 */
export const Name = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u),
  Schema.isMaxLength(48),
).pipe(Schema.brand("Environment.Name"), Schema.annotate({ identifier: "Environment.Name" }))
export type Name = typeof Name.Type

export const Kind = Schema.Literals(["local", "worktree", "sandbox"]).annotate({ identifier: "Environment.Kind" })
export type Kind = typeof Kind.Type

export const Status = Schema.Literals(["active", "missing"]).annotate({ identifier: "Environment.Status" })
export type Status = typeof Status.Type

/**
 * One sandbox policy surface as actually enforced on this machine. `full`
 * means the surface is enforced as specified; `degraded` means it is
 * enforced with a disclosed gap (the note says which); `unavailable` means
 * the surface cannot be enforced here at all. A degraded surface is always
 * disclosed, never silently presented as full.
 */
export const PolicySurface = Schema.Struct({
  status: Schema.Literals(["full", "degraded", "unavailable"]),
  note: optional(Schema.String),
}).annotate({ identifier: "Environment.PolicySurface" })
export interface PolicySurface extends Schema.Schema.Type<typeof PolicySurface> {}

/**
 * The sandbox policy summary carried by `sandbox` environment records:
 * which backend enforces the jail on this machine, the per-surface honesty
 * matrix for it, and the egress allowlist in force. Computed from the
 * record and the machine, never stored.
 */
export const PolicySummary = Schema.Struct({
  backend: Schema.Literals(["bwrap", "sandbox-exec", "none"]),
  filesystem: PolicySurface,
  network: PolicySurface,
  environment: PolicySurface,
  limits: PolicySurface,
  egressAllowlist: Schema.Array(Schema.String),
}).annotate({ identifier: "Environment.PolicySummary" })
export interface PolicySummary extends Schema.Schema.Type<typeof PolicySummary> {}

export const Info = Schema.Struct({
  id: ID,
  projectID: Project.ID,
  name: Schema.String,
  kind: Kind,
  /** Root path runs execute in: the project checkout for `local`, the worktree directory for `worktree`/`sandbox`. */
  directory: optional(AbsolutePath),
  /** The worktree environment's branch (`grist/<name>-<short id>`). */
  branch: optional(Schema.String),
  /** Machine identity for environments on this machine (OS hostname). */
  machine: optional(Schema.String),
  /** Account that created the environment, when known. Local records are single-user in v1 and leave it unset. */
  owner: optional(Schema.String),
  /** Sandbox policy summary; present only on `sandbox` records. */
  policy: optional(PolicySummary),
  status: Status,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    used: optional(DateTimeUtcFromMillis),
  }),
}).annotate({ identifier: "Environment.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  name: Name,
  kind: Kind,
}).annotate({ identifier: "Environment.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const RemoveInput = Schema.Struct({
  projectID: Project.ID,
  name: Name,
  force: Schema.Boolean,
}).annotate({ identifier: "Environment.RemoveInput" })
export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}

export const List = Schema.Array(Info).annotate({ identifier: "Environment.List" })
export type List = typeof List.Type
