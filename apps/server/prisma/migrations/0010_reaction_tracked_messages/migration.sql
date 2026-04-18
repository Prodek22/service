CREATE TABLE `reaction_tracked_messages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `message_id` VARCHAR(64) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `reaction_tracked_messages_message_id_key`(`message_id`),
  INDEX `reaction_tracked_messages_is_active_idx`(`is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

