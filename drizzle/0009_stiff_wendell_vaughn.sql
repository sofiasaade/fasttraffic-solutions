CREATE TABLE `job_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`detectedDate` varchar(10) NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`requestId` varchar(64),
	`company` varchar(255),
	`changeType` enum('new','cancelled','postponed','modified') NOT NULL,
	`fieldName` varchar(64),
	`oldValue` text,
	`newValue` text,
	`startDate` varchar(32),
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`airtableJobId` varchar(32) NOT NULL,
	`requestId` varchar(64),
	`company` varchar(255),
	`jobAddress` varchar(512),
	`startDate` varchar(32),
	`endDate` varchar(32),
	`status` varchar(64),
	`subStatus` varchar(128),
	`setupDuration` varchar(128),
	`closureType` varchar(512),
	`impact` varchar(64),
	`technicians` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_snapshots_id` PRIMARY KEY(`id`)
);
