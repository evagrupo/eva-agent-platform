CREATE TABLE `auth_resource_access` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`user_id` text,
	`group_id` text,
	`can_read` integer DEFAULT true NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`granted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `auth_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_resource_access_one_subject_check" CHECK(("auth_resource_access"."user_id" IS NOT NULL AND "auth_resource_access"."group_id" IS NULL) OR ("auth_resource_access"."user_id" IS NULL AND "auth_resource_access"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `auth_resource_access_user_idx` ON `auth_resource_access` (`user_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `auth_resource_access_group_idx` ON `auth_resource_access` (`group_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `auth_resource_access_resource_idx` ON `auth_resource_access` (`resource_type`,`resource_id`);