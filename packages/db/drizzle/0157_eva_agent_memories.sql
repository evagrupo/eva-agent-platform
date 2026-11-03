CREATE TABLE `eva_agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`kind` text NOT NULL,
	`source_thread_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `eva_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "eva_agent_memories_kind_check" CHECK("eva_agent_memories"."kind" IN ('preference', 'correction', 'pattern', 'fact')),
	CONSTRAINT "eva_agent_memories_title_check" CHECK(length("eva_agent_memories"."title") BETWEEN 1 AND 60),
	CONSTRAINT "eva_agent_memories_body_check" CHECK(length("eva_agent_memories"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX `eva_agent_memories_scope_updated_idx` ON `eva_agent_memories` (`agent_id`,`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `eva_agent_memories_owner_idx` ON `eva_agent_memories` (`owner_user_id`);