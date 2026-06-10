CREATE TABLE `app_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `change_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`actorUserId` int,
	`actorName` varchar(128),
	`action` varchar(64) NOT NULL,
	`fieldName` varchar(128),
	`oldValue` text,
	`newValue` text,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `change_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hazard_assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`phase` varchar(32) NOT NULL,
	`answers` text NOT NULL,
	`hazardsIdentified` text,
	`controlMeasures` text,
	`ppeConfirmed` boolean NOT NULL DEFAULT false,
	`signature` varchar(128),
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hazard_assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`airtableJobId` varchar(32),
	`type` enum('assigned','modified','cancelled','info') NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `technicians` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableName` varchar(128) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`userId` int,
	`phone` varchar(32),
	`zones` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `technicians_id` PRIMARY KEY(`id`),
	CONSTRAINT `technicians_airtableName_unique` UNIQUE(`airtableName`)
);
--> statement-breakpoint
CREATE TABLE `time_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`phase` varchar(32),
	`checkInAt` timestamp,
	`checkOutAt` timestamp,
	`hours` double,
	`checkInLat` double,
	`checkInLon` double,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `time_logs_id` PRIMARY KEY(`id`)
);
