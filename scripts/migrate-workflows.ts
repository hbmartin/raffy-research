import { runWorkflowMigration } from '../src/composition/workflow-migration';

await runWorkflowMigration((message) => console.info(message));
