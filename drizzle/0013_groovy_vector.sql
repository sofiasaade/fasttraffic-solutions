CREATE TABLE `flagging_hours` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`workDate` varchar(10) NOT NULL,
	`hours` double NOT NULL,
	`hourlyRateCents` int,
	`note` text,
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flagging_hours_id` PRIMARY KEY(`id`)
);
