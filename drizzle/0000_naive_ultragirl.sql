CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b8071' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `folders_user_idx` ON `folders` (`user_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`page` integer,
	`color` text DEFAULT '#f2d774' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`rects` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_user_paper_idx` ON `notes` (`user_id`,`paper_id`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`authors` text DEFAULT '' NOT NULL,
	`year` integer,
	`venue` text DEFAULT '' NOT NULL,
	`doi` text DEFAULT '' NOT NULL,
	`abstract` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`folder_id` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`current_page` integer DEFAULT 1 NOT NULL,
	`file_name` text,
	`file_size` integer DEFAULT 0 NOT NULL,
	`file_key` text,
	`file_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `papers_user_updated_idx` ON `papers` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_user_hash_idx` ON `papers` (`user_id`,`file_hash`);