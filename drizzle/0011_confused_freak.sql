ALTER TABLE `job_billing_notes` ADD `extraSignage` text;--> statement-breakpoint
ALTER TABLE `job_billing_notes` ADD `weekendSurcharge` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `job_billing_notes` ADD `holidaySurcharge` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `job_billing_notes` ADD `planStamped` varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_billing_notes` ADD `chargeAmountCents` int;--> statement-breakpoint
ALTER TABLE `job_billing_notes` ADD `chargeCategory` varchar(64);