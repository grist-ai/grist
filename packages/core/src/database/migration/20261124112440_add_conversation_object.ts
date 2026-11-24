import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261124112440_add_conversation_object",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`conversation\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`created_by\` text,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_conversation_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`conversation_id\` text;`)
    })
  },
}

export default migration
