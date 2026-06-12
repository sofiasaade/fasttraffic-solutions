CREATE TABLE `permit_extractions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`filename` varchar(512) NOT NULL,
	`fileUrl` text,
	`permitNumber` varchar(64),
	`validFromDate` varchar(10),
	`validFromTime` varchar(5),
	`validFromDay` varchar(16),
	`validToDate` varchar(10),
	`validToTime` varchar(5),
	`validToDay` varchar(16),
	`numberOfDays` int,
	`parseStatus` varchar(16) NOT NULL DEFAULT 'ok',
	`rawJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `permit_extractions_id` PRIMARY KEY(`id`)
);
