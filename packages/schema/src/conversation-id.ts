import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const ConversationID = Schema.String.check(Schema.isStartingWith("conv_")).pipe(
  Schema.brand("Conversation.ID"),
  Schema.annotate({ identifier: "Conversation.ID" }),
  statics((schema) => {
    const create = () => schema.make("conv_" + ascending())
    return {
      ascending: (id?: string) => {
        if (!id) return create()
        if (!id.startsWith("conv_")) throw new Error(`ID ${id} does not start with conv_`)
        return schema.make(id)
      },
      create,
    }
  }),
)
export type ConversationID = typeof ConversationID.Type
