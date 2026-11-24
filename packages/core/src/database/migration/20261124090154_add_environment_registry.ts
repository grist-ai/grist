import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261124090154_add_environment_registry",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`environment\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`directory\` text,
          \`branch\` text,
          \`machine\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_used\` integer,
          CONSTRAINT \`fk_environment_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`environment_id\` text;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`environment_project_name_idx\` ON \`environment\` (\`project_id\`,\`name\`);`,
      )
    })
  },
}

export default migration
