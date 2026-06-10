CREATE TABLE `job_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`phase` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`authorRole` varchar(32) NOT NULL,
	`note` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`endDate` varchar(32),
	`subStatus` varchar(128),
	`updatedByUserId` int,
	`updatedByName` varchar(128),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_overrides_airtableJobId_unique` UNIQUE(`airtableJobId`)
);
--> statement-breakpoint
CREATE TABLE `job_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`category` varchar(16) NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`storageUrl` varchar(1024) NOT NULL,
	`filename` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_photos_id` PRIMARY KEY(`id`)
);
