import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

// Machine-readable error codes; the renderer maps them to i18n copy.
export const GristAuthError = Schema.String

export const GristAuthStatusSchema = Schema.Struct({
  signedIn: Schema.Boolean,
  kind: Schema.NullOr(Schema.Union([Schema.Literal("invite"), Schema.Literal("api_key")])),
  gatewayUrl: Schema.NullOr(Schema.String),
})

export const GristAuthDeviceStartSchema = Schema.Struct({
  deviceCode: Schema.String,
  userCode: Schema.String,
  verificationUri: Schema.String,
  interval: Schema.Number,
  expiresIn: Schema.Number,
})

export const GristAuthPollResultSchema = Schema.Struct({
  status: Schema.Union([Schema.Literal("pending"), Schema.Literal("approved"), Schema.Literal("expired")]),
})

export const GristAuthStatus = Rpc.make("GristAuthStatus", { success: GristAuthStatusSchema })
export const GristAuthStartDevice = Rpc.make("GristAuthStartDevice", {
  success: GristAuthDeviceStartSchema,
  error: GristAuthError,
})
export const GristAuthPollDevice = Rpc.make("GristAuthPollDevice", {
  payload: { deviceCode: Schema.String },
  success: GristAuthPollResultSchema,
  error: GristAuthError,
})
export const GristAuthSaveApiKey = Rpc.make("GristAuthSaveApiKey", {
  payload: { apiKey: Schema.String },
  error: GristAuthError,
})
export const GristAuthLogout = Rpc.make("GristAuthLogout", { error: GristAuthError })

export const GristAuthRpcs = RpcGroup.make(
  GristAuthStatus,
  GristAuthStartDevice,
  GristAuthPollDevice,
  GristAuthSaveApiKey,
  GristAuthLogout,
)
