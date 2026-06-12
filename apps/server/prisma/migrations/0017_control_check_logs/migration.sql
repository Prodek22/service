CREATE TABLE `control_check_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `channel_id` VARCHAR(191) NOT NULL,
  `discord_user_id` VARCHAR(191) NOT NULL,
  `user_display_name` VARCHAR(191) NULL,
  `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `control_check_logs_channel_id_checked_at_idx`(`channel_id`, `checked_at`),
  INDEX `control_check_logs_discord_user_id_checked_at_idx`(`discord_user_id`, `checked_at`),
  INDEX `control_check_logs_checked_at_idx`(`checked_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
