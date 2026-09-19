CREATE TABLE `eva_agent_workspace_sync` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`remote_url` text,
	`branch` text DEFAULT 'main' NOT NULL,
	`last_operation` text DEFAULT 'none' NOT NULL,
	`last_result` text DEFAULT 'none' NOT NULL,
	`last_operation_at` integer,
	`last_commit_hash` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `eva_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `eva_agent_workspace_sync_enabled_idx` ON `eva_agent_workspace_sync` (`enabled`,`updated_at`);