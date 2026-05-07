CREATE TABLE `reaction_events` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `message_id` VARCHAR(64) NOT NULL,
  `channel_id` VARCHAR(64) NOT NULL,
  `guild_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `user_display_name` VARCHAR(191) NULL,
  `emoji_id` VARCHAR(64) NULL,
  `emoji_name` VARCHAR(191) NULL,
  `emoji_identifier` VARCHAR(191) NULL,
  `action` ENUM('ADD', 'REMOVE') NOT NULL,
  `event_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `reaction_events_message_id_event_at_idx`(`message_id`, `event_at`),
  INDEX `reaction_events_user_id_event_at_idx`(`user_id`, `event_at`),
  INDEX `reaction_events_event_at_idx`(`event_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;