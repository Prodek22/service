CREATE TABLE `audit_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `actor_username` VARCHAR(191) NULL,
  `actor_role` VARCHAR(32) NULL,
  `action` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(191) NULL,
  `entity_id` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `ip_address` VARCHAR(191) NULL,
  `user_agent` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `audit_logs_created_at_idx`(`created_at`),
  INDEX `audit_logs_action_idx`(`action`),
  INDEX `audit_logs_actor_username_idx`(`actor_username`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
