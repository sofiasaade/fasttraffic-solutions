CREATE TABLE `job_billing_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`note` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`authorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_billing_notes_id` PRIMARY KEY(`id`)
);
