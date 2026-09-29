CREATE TABLE `auth_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`policy_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_policies_role_idx` ON `auth_policies` (`role`);--> statement-breakpoint
ALTER TABLE `auth_groups` ADD `policy_id` text DEFAULT 'user' NOT NULL REFERENCES auth_policies(id);--> statement-breakpoint
CREATE INDEX `auth_groups_policy_idx` ON `auth_groups` (`policy_id`);--> statement-breakpoint
ALTER TABLE `auth_invitations` ADD `policy_id` text DEFAULT 'user' NOT NULL REFERENCES auth_policies(id);--> statement-breakpoint
ALTER TABLE `auth_principals` ADD `policy_id` text DEFAULT 'user' NOT NULL REFERENCES auth_policies(id);--> statement-breakpoint
CREATE INDEX `auth_principals_policy_idx` ON `auth_principals` (`policy_id`);--> statement-breakpoint
UPDATE `auth_principals` SET `policy_id` = 'admin' WHERE `role` = 'admin';