import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const EnvironmentID = Schema.String.check(Schema.isStartingWith("env_")).pipe(
  Schema.brand("Environment.ID"),
  Schema.annotate({ identifier: "Environment.ID" }),
  statics((schema) => {
    const create = () => schema.make("env_" + ascending())
    return {
      ascending: (id?: string) => {
        if (!id) return create()
        if (!id.startsWith("env_")) throw new Error(`ID ${id} does not start with env_`)
        return schema.make(id)
      },
      create,
    }
  }),
)
export type EnvironmentID = typeof EnvironmentID.Type

/** The implicit environment zero: the project's own working copy on this machine. */
export const LOCAL_ENVIRONMENT_ID = EnvironmentID.make("env_local")
