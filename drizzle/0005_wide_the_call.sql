CREATE TABLE `equipment_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`equipmentName` varchar(128) NOT NULL,
	`scheduledDate` varchar(10) NOT NULL,
	`technicianName` varchar(128),
	`quantity` int NOT NULL DEFAULT 1,
	`notes` text,
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equipment_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_catalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` varchar(64),
	`color` varchar(16),
	`active` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equipment_catalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `equipment_catalog_name_unique` UNIQUE(`name`)
);
