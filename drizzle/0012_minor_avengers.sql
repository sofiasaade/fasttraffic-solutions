CREATE TABLE `technician_availability` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableName` varchar(128) NOT NULL,
	`kind` enum('weekday','date') NOT NULL,
	`weekday` int,
	`date` varchar(10),
	`available` boolean NOT NULL,
	`reason` varchar(255),
	`updatedByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `technician_availability_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `technician_certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableName` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`issuer` varchar(255),
	`issuedDate` varchar(10),
	`expiryDate` varchar(10),
	`fileKey` varchar(512),
	`fileUrl` varchar(1024),
	`fileName` varchar(255),
	`mimeType` varchar(128),
	`uploadedByUserId` int,
	`uploadedByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `technician_certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `technician_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableName` varchar(128) NOT NULL,
	`headline` varchar(255),
	`experienceSummary` text,
	`yearsExperience` int,
	`updatedByUserId` int,
	`updatedByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `technician_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `technician_profiles_airtableName_unique` UNIQUE(`airtableName`)
);
--> statement-breakpoint
ALTER TABLE `technicians` MODIFY COLUMN `experienceLevel` enum('apprentice','junior','senior') NOT NULL DEFAULT 'junior';