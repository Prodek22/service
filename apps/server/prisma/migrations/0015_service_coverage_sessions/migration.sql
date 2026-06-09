CREATE TABLE `service_coverage_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `discord_user_id` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(191) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at` DATETIME(3) NULL,
  `started_by` VARCHAR(191) NULL,
  `ended_by` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `service_coverage_sessions_discord_user_id_ended_at_idx`(`discord_user_id`, `ended_at`),
  INDEX `service_coverage_sessions_started_at_idx`(`started_at`),
  INDEX `service_coverage_sessions_ended_at_idx`(`ended_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
