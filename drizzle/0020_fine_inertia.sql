ALTER TABLE `scheduler_day_notes` ADD `cancelled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduler_day_notes` ADD `postponed` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduler_day_notes` ADD `missingSigns` boolean DEFAULT false NOT NULL;