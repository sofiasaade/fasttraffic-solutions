ALTER TABLE `job_assignments` ADD `status` varchar(16) DEFAULT 'tentative' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_assignments` ADD `confirmedAt` timestamp;--> statement-breakpoint
ALTER TABLE `job_assignments` ADD `confirmedByName` varchar(128);