CREATE TABLE `scheduler_day_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`noteDate` varchar(10) NOT NULL,
	`note` text NOT NULL,
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduler_day_notes_id` PRIMARY KEY(`id`)
);
