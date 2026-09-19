DROP INDEX `auth_policies_role_idx`;--> statement-breakpoint
CREATE INDEX `auth_policies_role_idx` ON `auth_policies` (`role`);