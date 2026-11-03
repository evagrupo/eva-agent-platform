PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_eva_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`source_provider_id` text,
	`provider_ids_json` text NOT NULL,
	`default_provider_id` text,
	`default_model` text NOT NULL,
	`default_reasoning_level` text NOT NULL,
	`default_permission_mode` text NOT NULL,
	`fixed_execution` integer DEFAULT false NOT NULL,
	`reasoning_levels_json` text NOT NULL,
	`permission_modes_json` text NOT NULL,
	`instructions` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_eva_agents`("id", "display_name", "description", "icon", "status", "source_provider_id", "provider_ids_json", "default_provider_id", "default_model", "default_reasoning_level", "default_permission_mode", "fixed_execution", "reasoning_levels_json", "permission_modes_json", "instructions", "sort_order", "created_at", "updated_at") SELECT "id", "display_name", "description", "icon", "status", "source_provider_id", "provider_ids_json", "default_provider_id", "default_model", "default_reasoning_level", "default_permission_mode", "fixed_execution", "reasoning_levels_json", "permission_modes_json", "instructions", "sort_order", "created_at", "updated_at" FROM `eva_agents`;--> statement-breakpoint
DROP TABLE `eva_agents`;--> statement-breakpoint
ALTER TABLE `__new_eva_agents` RENAME TO `eva_agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `eva_agents_status_sort_idx` ON `eva_agents` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `eva_agents_updated_idx` ON `eva_agents` (`updated_at`);
--> statement-breakpoint
UPDATE `eva_agents` SET `status` = 'live' WHERE `status` != 'live';
