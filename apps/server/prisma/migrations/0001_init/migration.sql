-- CreateTable
CREATE TABLE `employees` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `discord_user_id` VARCHAR(191) NULL,
  `nickname` VARCHAR(191) NULL,
  `full_name` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NULL,
  `plate_number` VARCHAR(191) NULL,
  `iban` VARCHAR(191) NULL,
  `months_in_city` INT NULL,
  `employer_name` VARCHAR(191) NULL,
  `recommendation` VARCHAR(191) NULL,
  `rank` VARCHAR(191) NULL,
  `id_image_url` VARCHAR(191) NULL,
  `cv_message_id` VARCHAR(191) NULL,
  `cv_channel_id` VARCHAR(191) NULL,
  `cv_posted_at` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INCOMPLETE','DELETED') NOT NULL DEFAULT 'INCOMPLETE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,

  UNIQUE INDEX `employees_iban_key`(`iban`),
  UNIQUE INDEX `employees_cv_message_id_key`(`cv_message_id`),
  INDEX `employees_discord_user_id_idx`(`discord_user_id`),
  INDEX `employees_full_name_idx`(`full_name`),
  INDEX `employees_nickname_idx`(`nickname`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_cv_raw` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `raw_text` LONGTEXT NOT NULL,
  `raw_attachments_json` LONGTEXT NULL,
  `parse_status` ENUM('SUCCESS','PARTIAL','FAILED') NOT NULL DEFAULT 'PARTIAL',
  `parse_notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `employee_cv_raw_employee_id_idx`(`employee_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_aliases` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `alias_type` VARCHAR(191) NOT NULL,
  `alias_value` VARCHAR(191) NOT NULL,
  `normalized` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `employee_aliases_employee_id_normalized_key`(`employee_id`, `normalized`),
  INDEX `employee_aliases_normalized_idx`(`normalized`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `week_cycles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `service_code` VARCHAR(191) NOT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `reset_message_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `week_cycles_service_code_idx`(`service_code`),
  INDEX `week_cycles_started_at_idx`(`started_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `time_events` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `discord_message_id` VARCHAR(191) NOT NULL,
  `channel_id` VARCHAR(191) NOT NULL,
  `discord_user_id` VARCHAR(191) NULL,
  `actor_discord_user_id` VARCHAR(191) NULL,
  `actor_name` VARCHAR(191) NULL,
  `target_employee_id` INT NULL,
  `target_employee_name` VARCHAR(191) NULL,
  `service_code` VARCHAR(191) NULL,
  `event_type` ENUM('CLOCK_IN','CLOCK_OUT','MANUAL_ADJUSTMENT','WEEKLY_RESET','UNKNOWN') NOT NULL,
  `delta_seconds` INT NULL,
  `raw_text` LONGTEXT NOT NULL,
  `event_at` DATETIME(3) NOT NULL,
  `week_cycle_id` INT NULL,
  `is_deleted` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `time_events_discord_message_id_key`(`discord_message_id`),
  INDEX `time_events_discord_user_id_idx`(`discord_user_id`),
  INDEX `time_events_service_code_idx`(`service_code`),
  INDEX `time_events_event_at_idx`(`event_at`),
  INDEX `time_events_week_cycle_id_idx`(`week_cycle_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_cv_raw` ADD CONSTRAINT `employee_cv_raw_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_aliases` ADD CONSTRAINT `employee_aliases_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_events` ADD CONSTRAINT `time_events_target_employee_id_fkey`
  FOREIGN KEY (`target_employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_events` ADD CONSTRAINT `time_events_week_cycle_id_fkey`
  FOREIGN KEY (`week_cycle_id`) REFERENCES `week_cycles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

