import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { absoluteColumn } from "../database/path.js"
import { Timestamps } from "../database/schema.sql.js"
import { ProjectTable } from "../project/sql.js"
import { ProjectSchema } from "../project/schema.js"
import { Environment } from "@opencode/schema/environment"

/**
 * Stored environments for a project. Environment zero (kind `local`) is
 * implicit and never stored — it is synthesized from the project row.
 * Only `worktree` rows exist in v1; `sandbox` rows arrive with S-ENV-SBX.
 */
export const EnvironmentTable = sqliteTable(
  "environment",
  {
    id: text().$type<Environment.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().$type<Environment.Name>().notNull(),
    kind: text().$type<Environment.Kind>().notNull(),
    directory: absoluteColumn(),
    branch: text(),
    machine: text(),
    ...Timestamps,
    time_used: integer(),
  },
  (table) => [uniqueIndex("environment_project_name_idx").on(table.project_id, table.name)],
)
