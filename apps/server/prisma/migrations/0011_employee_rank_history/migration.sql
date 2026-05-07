CREATE TABLE `employee_rank_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `rank` VARCHAR(191) NOT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `source` VARCHAR(191) NULL,
  `changed_by` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `employee_rank_history_employee_id_effective_from_idx`(`employee_id`, `effective_from`),
  INDEX `employee_rank_history_effective_from_idx`(`effective_from`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_rank_history`
ADD CONSTRAINT `employee_rank_history_employee_id_fkey`
FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
