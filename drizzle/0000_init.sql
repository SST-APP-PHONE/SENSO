CREATE TABLE `admin_users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(190) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` varchar(10) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`failed_attempts` int unsigned NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`last_login_at` datetime(3),
	`session_version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`admin_user_id` bigint unsigned,
	`action` varchar(60) NOT NULL,
	`entity` varchar(40),
	`entity_id` varchar(64),
	`details` json,
	`ip_prefix` varchar(64),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`type` varchar(20) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`system_key` varchar(20),
	`started_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`created_by_admin_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_system_key_uq` UNIQUE(`system_key`)
);
--> statement-breakpoint
CREATE TABLE `folio_counters` (
	`year` smallint NOT NULL,
	`last_value` int unsigned NOT NULL,
	CONSTRAINT `folio_counters_year` PRIMARY KEY(`year`)
);
--> statement-breakpoint
CREATE TABLE `report_updates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`client_update_id` char(36) NOT NULL,
	`client_operation_id` char(36) NOT NULL,
	`report_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`status` varchar(15) NOT NULL,
	`comment` text,
	`latitude` double,
	`longitude` double,
	`accuracy_m` double,
	`location_captured_at` datetime(3),
	`created_at_client` datetime(3) NOT NULL,
	`timezone_offset_min` smallint NOT NULL,
	`connectivity` varchar(10) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	CONSTRAINT `report_updates_id` PRIMARY KEY(`id`),
	CONSTRAINT `updates_client_update_uq` UNIQUE(`client_update_id`),
	CONSTRAINT `updates_client_op_uq` UNIQUE(`client_operation_id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`client_report_id` char(36) NOT NULL,
	`client_operation_id` char(36) NOT NULL,
	`folio` varchar(32) NOT NULL,
	`local_folio` varchar(40) NOT NULL,
	`event_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`category_group` varchar(10) NOT NULL,
	`category` varchar(30) NOT NULL,
	`initial_status` varchar(15) NOT NULL,
	`current_status` varchar(15) NOT NULL,
	`severity` varchar(10) NOT NULL,
	`comment` text,
	`municipality` varchar(120),
	`latitude` double,
	`longitude` double,
	`accuracy_m` double,
	`location_captured_at` datetime(3),
	`created_at_client` datetime(3) NOT NULL,
	`timezone_offset_min` smallint NOT NULL,
	`connectivity` varchar(10) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`last_status_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `reports_client_report_uq` UNIQUE(`client_report_id`),
	CONSTRAINT `reports_client_op_uq` UNIQUE(`client_operation_id`),
	CONSTRAINT `reports_folio_uq` UNIQUE(`folio`)
);
--> statement-breakpoint
CREATE TABLE `sync_operations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`client_operation_id` char(36) NOT NULL,
	`type` varchar(20) NOT NULL,
	`payload_hash` char(64) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`report_id` bigint unsigned NOT NULL,
	`report_update_id` bigint unsigned,
	`received_at` datetime(3) NOT NULL,
	CONSTRAINT `sync_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_ops_client_op_uq` UNIQUE(`client_operation_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`device_id` char(36) NOT NULL,
	`platform` varchar(60),
	`first_seen_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_device_uq` UNIQUE(`device_id`)
);
--> statement-breakpoint
ALTER TABLE `report_updates` ADD CONSTRAINT `report_updates_report_id_reports_id_fk` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `report_updates` ADD CONSTRAINT `report_updates_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_admin_idx` ON `audit_log` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `events_active_idx` ON `events` (`is_active`);--> statement-breakpoint
CREATE INDEX `events_default_idx` ON `events` (`is_default`);--> statement-breakpoint
CREATE INDEX `updates_report_idx` ON `report_updates` (`report_id`,`created_at_client`);--> statement-breakpoint
CREATE INDEX `updates_status_idx` ON `report_updates` (`status`);--> statement-breakpoint
CREATE INDEX `reports_created_idx` ON `reports` (`created_at_client`);--> statement-breakpoint
CREATE INDEX `reports_event_idx` ON `reports` (`event_id`,`created_at_client`);--> statement-breakpoint
CREATE INDEX `reports_category_idx` ON `reports` (`category`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`current_status`);--> statement-breakpoint
CREATE INDEX `reports_lat_lng_idx` ON `reports` (`latitude`,`longitude`);--> statement-breakpoint
CREATE INDEX `reports_municipality_idx` ON `reports` (`municipality`);--> statement-breakpoint
CREATE INDEX `reports_user_idx` ON `reports` (`user_id`);--> statement-breakpoint
CREATE INDEX `sync_ops_received_idx` ON `sync_operations` (`received_at`);