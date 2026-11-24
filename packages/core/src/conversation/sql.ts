import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql.js"
import { ProjectTable } from "../project/sql.js"
import { ProjectSchema } from "../project/schema.js"
import { Conversation } from "@opencode/schema/conversation"

/**
 * Stored conversations for a project (spec §5.1). The session link is NOT
 * stored here: sessions carry `conversation_id`, and a conversation's
 * ordered session list is composed from those rows at read time.
 */
export const ConversationTable = sqliteTable("conversation", {
  id: text().$type<Conversation.ID>().primaryKey(),
  project_id: text()
    .$type<ProjectSchema.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  title: text().notNull(),
  created_by: text(),
  status: text().$type<Conversation.Status>().notNull(),
  ...Timestamps,
})
