CREATE TABLE `truck_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`truckName` varchar(128) NOT NULL,
	`scheduledDate` varchar(10) NOT NULL,
	`driverName` varchar(128),
	`notes` text,
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `truck_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `truck_catalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`plate` varchar(32),
	`color` varchar(16),
	`active` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `truck_catalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `truck_catalog_name_unique` UNIQUE(`name`)
);
