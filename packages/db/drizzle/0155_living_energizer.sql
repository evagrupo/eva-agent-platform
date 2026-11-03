CREATE TABLE `eva_agent_chats` (
	`agent_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `owner_user_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `eva_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `eva_agent_chats_owner_idx` ON `eva_agent_chats` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `eva_agent_chats_thread_idx` ON `eva_agent_chats` (`thread_id`);