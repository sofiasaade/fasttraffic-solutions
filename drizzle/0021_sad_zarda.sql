CREATE TABLE `invoice_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`description` varchar(512) NOT NULL,
	`quantity` double NOT NULL DEFAULT 1,
	`unitCents` int NOT NULL DEFAULT 0,
	`amountCents` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNumber` varchar(32) NOT NULL,
	`airtableJobId` varchar(32),
	`clientName` varchar(256) NOT NULL,
	`jobAddress` varchar(512),
	`issueDate` varchar(10) NOT NULL,
	`dueDate` varchar(10),
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`subtotalCents` int NOT NULL DEFAULT 0,
	`gstRate` double NOT NULL DEFAULT 5,
	`gstCents` int NOT NULL DEFAULT 0,
	`totalCents` int NOT NULL DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tech_day_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`technicianName` varchar(128) NOT NULL,
	`date` varchar(10) NOT NULL,
	`truckName` varchar(128),
	`truckCode` varchar(32),
	`checkInAt` timestamp NOT NULL DEFAULT (now()),
	`checkOutAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tech_day_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `job_assignments` ADD `note` text;--> statement-breakpoint
ALTER TABLE `job_assignments` ADD `completedAt` timestamp;--> statement-breakpoint
ALTER TABLE `job_notes` ADD `category` varchar(16) DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `technicians` ADD `pin` varchar(8);