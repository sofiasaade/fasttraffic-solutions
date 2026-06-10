CREATE TABLE `scheduler_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`phase` varchar(32) NOT NULL,
	`scheduledDate` varchar(10) NOT NULL,
	`startTime` varchar(5),
	`endTime` varchar(5),
	`createdByUserId` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduler_assignments_id` PRIMARY KEY(`id`)
);
