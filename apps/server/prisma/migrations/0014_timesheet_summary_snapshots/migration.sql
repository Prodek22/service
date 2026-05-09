CREATE TABLE `timesheet_summary_snapshots` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `week_cycle_id` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'BUILDING',
  `payload_json` LONGTEXT NULL,
  `error_text` TEXT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `generated_at` DATETIME(3) NULL,
  `build_started_at` DATETIME(3) NULL,
  `build_finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `timesheet_summary_snapshots_week_cycle_id_key`(`week_cycle_id`),
  INDEX `timesheet_summary_snapshots_status_idx`(`status`),
  INDEX `timesheet_summary_snapshots_generated_at_idx`(`generated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `timesheet_summary_snapshots_week_cycle_id_fkey`
    FOREIGN KEY (`week_cycle_id`) REFERENCES `week_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
